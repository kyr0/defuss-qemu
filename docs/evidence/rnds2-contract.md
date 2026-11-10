# SHA256RNDS2 compiled intrinsic

`rnds2_candidates.py` exports `changes(kind, source_root)` for `rnds2` and
`rnds2-check`. The supplied source tree must already contain the validated
`bun-replay/jit-pshufb` backend. The production overlay changes that backend
and returns `tcg/tcg.c` for recompilation; the diagnostic overlay also rebuilds
the original SHA helper translation unit with counters and native checks.
Original QEMU sources and existing runtime artifacts are never edited.

## Exact lowering

The original helper is `void(d, a, b, uint32_t wk0, uint32_t wk1)`, with no
environment argument. Call-stack slots are d=0, a=8, b=16, wk0=24, wk1=32.
The guard requires the exact helper name `sha256rnds2`, its metadata's original
function address, the complete void(ptr,ptr,ptr,i32,i32) type mask, and absence
of NO_RETURN. Deferred emission exits before this dispatch. Every other helper
keeps its previous call and unwind handling; the original RNDS2 TCI helper is
unchanged except for diagnostic counting.

The translator already captures XMM0's two key/message words before the helper
call. The intrinsic consumes those ABI values; it never reloads XMM0 after a
destination update. All eight input state dwords are loaded once before any
output store, as four packed i64 values:

| Existing local | Initial low / high dword | After round 0 |
| --- | --- | --- |
| TCG R0 | B / A | unchanged |
| TCG R1 | F / E | unchanged |
| TMP64_0 | D / C | EE0 / C |
| TMP64_1 | H / G | AA0 / G |

R0/R1 are exactly the backend's two call-clobbered registers. The normal
allocator frees/spills them before the call, and this void helper has no return
binding. No register outside that set, no module-local declarations, and no
resume/global layout changes are needed. TMP32_0 holds the current round's t;
it is replaced only after both AA0 and EE0 are computed.

Each round uses i32 rotate, Boolean operations and modular addition. Choice is
`g ^ (e & (f ^ g))`; majority is `(a & b) ^ (c & (a ^ b))`. The missing standard
opcode declarations I32_AND=0x71 and I32_XOR=0x73 are added explicitly. The
second round uses AA0/EE0 and retained old A/B/C/E/F/G. Both wk values and every
architectural input are consumed before stores produce
`d[0..3] = [EE0, EE1, AA0, AA1]`. Bytes above low 128 bits remain unchanged.
Pointers use the existing memory32/memory64 normalization; guest-memory operand
loads and faults remain in the unmodified x86 translator before the helper.

## Diagnostic contract

`_defuss_inline_rnds2_counts(clear)` returns **three uint64 words**, no header:

| Word | Meaning |
| --- | --- |
| 0 | Actual original/native helper entries, interpreted or compiled |
| 1 | Actual compiled inline RNDS2 executions |
| 2 | Compiled original-helper calls, a subset of word 0 |

Sum words 0+1 for total executions. Word 0 minus word 2 identifies interpreted
registered calls when native selftests/direct calls are excluded. Current exact
matches always inline, so word 2 is expected to remain zero; it is retained to
make fallback accounting explicit. Unmatched/dynamically substituted metadata
remains outside this exact-helper classification. Counters assume one vCPU;
clear after initialization/native tests and read only at stopped guest gates.
Diagnostics cannot provide performance measurements.

Two additional diagnostic exports return zero on success:

- `_defuss_inline_rnds2_guard_selftest()`: exact match, dynamic substitution,
  NO_RETURN, missing/wrong helper name, signed versus unsigned wk signatures,
  and an extra ABI argument. It tests selection, not emitted execution.
- `_defuss_inline_rnds2_helper_selftest()`: **20,480** original-helper checks,
  five d/a/b alias partitions × 4096 input sets, including edges and random
  words. An independent loop over eight SHA state words computes the oracle;
  comparisons include all three 64-byte register banks and untouched bytes.

## Gated guest

`prepare-rnds2-fixture.py FRESH-LABEL` runs inside the pinned Linux SDK and
creates an unused directory under `bun-inline`. It archives the fixture,
oracle and packager, compiles a static guest, then records binary/initramfs
hashes and its exact command. It never replaces the timed Bun guest. Flags
include `-mavx2 -msha -mno-red-zone` and disable tree/SLP vectorization.

`rnds2-fixture.c` uses legacy opcode bytes `0f 38 cb /r`, with implicit XMM0.
This avoids assembler differences in spelling the implicit third operand.
Legacy d=a is inherent to the instruction; broader helper pointer partitions
are covered by the native helper test.

| Mode | Destination | Explicit source | Implicit message words |
| --- | --- | --- | --- |
| 0 | XMM1 | XMM2 | XMM0 |
| 1 | XMM1 | XMM1 | XMM0 |
| 2 | XMM0 | XMM1 | XMM0 |
| 3 | XMM1 | XMM0 | XMM0 |
| 4 | XMM0 | XMM0 | XMM0 |
| 5 | XMM1 | aligned [RDI] | XMM0 |
| 6 | XMM0 | aligned [RDI] | XMM0 |

Every mode performs **4096** operations: **28,672 total**, including `--cold`.
Zero, all-one, sign-bit and alternating-bit inputs recur every 32 iterations,
so edge cases remain represented after the normal hot threshold of 1500.
The fixture compares three complete YMM registers and the memory-source bank,
including unchanged upper halves and source registers. Arithmetic flags are
alternately set/cleared and compared immediately around the instruction.

Optional positional mode 0..6 selects one mode. `--gate` uses a persistent raw
COM1 fd; console must be COM2 (`console=ttyS1`). Kernel options are
`rnds2_kind=N`, `replay_gate=1`, and `replay_cold=1`. Initial marker is
`RNDS2_GATE:-1`; after each `RNDS2_MODE_PASS:N checks=4096`, marker
`RNDS2_GATE:N` is flushed, ASCII G is written/drained to COM1, and the guest
blocks for K. Host stops via QMP, records counters, queues K and continues.
Final `RNDS2_FIXTURE_PASS` and `FIXTURE_PASS` occur after the final ACK.

At hot1500 with admission disabled, each mode must show positive original and
inline counts, word2 zero, and word0+word1 exactly 4096. At hot65535 every mode
must show word0=4096 and words1/2=0. The baseline and uninstrumented production
guest must pass the same oracle checks. Gates prove each alias/form reached
the intended tier; native tests alone cannot establish compiled correctness.

## Current status and limits

Both native builds and selftests passed, including 20,480 helper/oracle cases.
Baseline, hot diagnostic, cold diagnostic and production guest fixtures all
passed 28,672 checks each. Every hot mode reached the inline path, and every
cold mode stayed on the original helper. The production original-Bun run
passed all 12 results. Diagnostic snapshot replay verified compiled RNDS2
execution in every restored SHA batch. Independent static review confirmed
packed-state dataflow and ABI handling and caught the missing scalar opcode
declarations before the builds. See `VALIDATION.json` for exact evidence and
`RESULTS.md` for the separate uninstrumented performance findings.

The setup candidate's early allocator path must remain limited to its exact
existing SIMD helpers: RNDS2 relies on the normal R0/R1 call-clobber path.
Unmatched helper selection and memory-fault handling are source-reviewed;
the guest does not deliberately synthesize invalid helper metadata or faults.
