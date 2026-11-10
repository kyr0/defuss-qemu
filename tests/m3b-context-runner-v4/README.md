# M3b host terminal log v4 over unchanged census ABI2

This new17-file host adapter preserves the ABI2 runtime, original45-gate
guest workload, accounting-v2 oracle, pending64MiB queue, total512MiB trace
bound and128MiB stopped gate windows. Its only terminal-tail allowance is a
separate, fully parsed suffix of at most64KiB containing exact QEMU
`Linking TBs` records. Frozen v3 sources and their failed capture remain
unchanged. No native rebuild or retroactive acceptance follows from this source.

The actual v3 OFF01 capture retained all45 expected gates and the guest PASS
with943364 checks and digest `2f5b81ae5cb6964b`. It then failed the original
zero-byte terminal-tail assertion: the suffix was exactly43 bytes,
`Linking TBs 0x96c1140 index 1 -> 0x9766980` plus newline. The independently
reviewed native `tb_add_jump` site logs this line with `CPU_LOG_EXEC` without
an address-filter check. The old capture remains failed and its independent
review and exact report are mandatory inputs to the v4 freeze.

The new terminal parser accepts an empty suffix or only newline-terminated
ASCII `Linking TBs 0x<nonzero uint64 hex> index <0|1> -> 0x<nonzero uint64 hex>`
lines. Partial lines, blank lines, CR, malformed pointers/indices and every
other byte or record type fail. There is no suffix skipping, splitting,
filtering or fallback to the general trace parser. A separate
`terminal-summary.json` retains exact offsets, byte count, SHA256, link count,
zero execution-record count, source site, bound native source identity and
runtime fingerprint. It is fsynced before the complete oracle runs and is
also bound as `report.terminalSummary`; the45 original stopped-window
summaries remain separate and unchanged. Offline replay derives the same
summary from the retained raw bytes.

The complete oracle additionally requires the cumulative watched census
count to equal the preceding final reset. All watch slots are already
disabled then. Neither that equality nor the linking-only log proves absence
of unwatched kernel execution. The claim is only that no Trace, Stopped, CPU,
disassembly or unknown record occurs in this exact terminal suffix.

`windows.mjs` retains source-bound copies of the ABI2 `segment` and
`parseContextTrace` functions with the previously reviewed128MiB guard.
Source-equivalence tests require all45 v3 gate-window rules to remain exact
and the watched-total guard to be the sole oracle change. Parser boundary,
malformed-record and publication tests are source-only until root executes
and retains them. Current host tests, source freeze/review and real v4 captures
remain pending at authoring; earlier runtime/build validation does not replace them.

Both arms enable the census before the vCPU starts. Every paused gate retains
raw M3a96/M3b128/boundary256/census2400 banks before semantic decoding. The
census watches exact A only, while the existing M3a/M3b watches retain A and B.
Each gate configures exactly four new census epochs. Positive ON watches,
including warmup, require a fused normal owner. OFF and rejection-shape watches
permit ordinary normal owners and preserve the original validator.

For positive ON measured windows, `validateCensusContextWindow` requires the
complete attempted-entry census and the frozen guest CFG. The logical body
partition is fused B attempts + certified ordinary RF A-to-B continuations +
source-known initial direct-B calls. Requested B exits already belong to the
fused-attempt term. Ordinary B selected counts remain attempted entries and
are never presented as retired bodies. Every RF A attempt must have a complete
raw frame classified as a B transition, a terminal side transition or an exact
generic refusal. Unclassified or ambiguous continuations reject acceptance.
The raw normal/RF tuples bind owner generation, code/header, physical pages,
flags/cflags and execution context, including hidden normal entries. The warm
owner must remain stable. Final guest integer, flags and defined legacy FXSAVE
checks and every original digest/check total remain unchanged.

The prior closed forensic-v2 gate3 had486 fused B attempts and64 certified
ordinary RF A-to-B continuations with the expected550-body guest result. That
failed old-runtime capture remains failed. It cannot satisfy the new census
requirement or be retroactively accepted.

Capture and durability bounds are fixed before execution:

- Distinct report/factory argument arrays prevent Emscripten's program-name
  insertion from changing the declared command line.
- All eleven exact ELF extents are logged with `exec,in_asm,cpu`, without
  `nochain`. Total trace is bounded at512MiB, the raw producer queue at64MiB,
  each stopped gate parse window at128MiB, and the complete suffix at64KiB.
  Overflow fails; bytes are never dropped.
- Canonical base64 chunks contain at most64KiB. Data and contiguous hash/index
  metadata are fsynced before host acknowledgement. Gate drains require zero
  pending bytes and produced=queued=acknowledged totals; queue peaks and latency
  fields are retained. No VM yield, forced GC or emulated service turn is added.
- The layout-gate0 boot prefix is retained and hashed, but is not interpreted as
  64-bit user code. Subsequent windows start at the exact prior ACK offset;
  no user bytes are skipped. Each window is parsed while the VM remains paused,
  and its bounded summary is fsynced before the acceptance oracle runs.
- Oracle refusal sends no further ACK/cont. Page errors, deadlines and final
  pause failure retain failure evidence. An external owned-process deadline
  remains required for blocked host I/O or browser teardown.

`inspect.mjs` replays closed captures with the same reviewed oracle. It streams
all indexed chunks and parses one bounded window at a time, verifies the
combined source/runtime/image proof, raw serial sequence, bank epochs and
saved windows and terminal summary, and rehashes all retained inputs. This is same-code replay;
independent capture review remains a separate gate. Recovery, natural
retirement, general DMA correctness and full extended architectural state are
not established by this fixture.

The unchanged combined ABI2 source manifest/review remain authoritative for
the runtime. The separate host-v4 freeze requires that full parent proof,
the frozen v3 host manifest/review and the independent failed-v3 capture review.
`identity.mjs` first invokes the unchanged v3 verifier, including its prior
ABI2/v2 chain, then verifies all17 new live/archive files and dependencies. The new host source never substitutes a runtime
binding. Future commands require a stopped builder, completed host checks and
independent source review:

```sh
python3 -B scripts/with-tmp.py -- node --test --test-concurrency=1 \
  tests/m3b-context-runner-v4/test.mjs \
  tests/m3b-context-runner-v4/test-transport.mjs \
  tests/m3b-context-runner-v4/test-trace.mjs \
  tests/m3b-context-runner-v4/test-windows.mjs \
  tests/m3b-context-runner-v4/test-oracle.mjs \
  tests/m3b-context-accounting-v2/test-contract.mjs \
  tests/m3b-context-accounting-v2/test-census-reader.mjs \
  tests/m3b-context-accounting-v2/test-integration.mjs

python3 -B scripts/with-tmp.py -- node tests/m3b-context-runner-v4/run.mjs \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --fixture artifacts/m3b-fixture-01 \
  --source-manifest artifacts/m3b-context-v4-source-01/manifest.json \
  --source-review artifacts/m3b-context-v4-source-review-01/review.json \
  --enabled 0 --timeout 1800000 --output artifacts/m3b-context-v4-off-01
# Repeat serially with --enabled 1 and a fresh artifacts/m3b-context-v4-on-01.

python3 -B scripts/with-tmp.py -- node tests/m3b-context-runner-v4/inspect.mjs \
  --run artifacts/m3b-context-v4-on-01 --output artifacts/m3b-context-v4-inspection-on-01
```

`DEFUSS_VM_CHROME` must name the reviewed Chrome binary. The fixed profile
retains512MiB RAM, `apic.vapic=off`, M3a enabled, hot1500/flags2 and cap12000.
All scratch stays under project `tmp`. Prospective artifact names above are
not evidence that a binding, build or real capture already exists.
