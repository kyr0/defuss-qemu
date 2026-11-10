# Exact SHA256MSG1 candidate contract

This is the source-grounded contract for a separate selectable candidate. A
source overlay generator, emitter and native/emitted-WASM fixtures are prepared;
they have not been executed. No SDK build, guest validation, diagnostic exposure
run or performance result is claimed. The retained engine and frozen MSG2 inputs
are unchanged. `contract.json` records the inspected file identities and original
M1 evidence. The original contract-only version is preserved in
`artifacts/m2-msg1-contract-01`; `README.md` tracks current execution readiness.

The corrected M1 pilot observed compiled `sha256msg1` helper calls in all three
SHA phases: 19,378,514, 19,666,429 and 19,667,607. These are exposure counts,
not exclusive time fractions. The live MSG2 diagnostic confirms that the
unchanged Bun SHA workload reaches compiled SHA code under production flags3
and hotLimit1500; a future MSG1 candidate must prove its own selected path.

## Exact operation and aliases

The reference is `helper_sha256msg1` in `engine/qemu/target/i386/ops_sse.h:2640`,
including its explicit save of `b->L(0)` before the first write. Define:

```text
S(x) = rotr32(x,7) XOR rotr32(x,18) XOR logical_shift_right32(x,3)
saved_b0 = b[0]                  // read once, before any destination write
d[0] = a[0] + S(a[1])            // each addition wraps modulo 2^32
d[1] = a[1] + S(a[2])
d[2] = a[2] + S(a[3])
d[3] = a[3] + S(saved_b0)
```

The four assignments occur in this order. Each assignment's source loads occur
before its store. Do not preload the whole `a` vector or defer all stores:
synthetic partial overlaps must retain the original helper's sequential
semantics. For example, with `d = a + 4 bytes`, the first store overwrites
`a[1]`; the next assignment must read that new word. With `d == b`, the last
assignment must use the original `b[0]`, even though `d[0]` has replaced it.

Cover all five whole-pointer equality partitions: all distinct, `d==a`,
`d==b`, `a==b`, and all equal. Word-aligned partial overlaps extend the
synthetic oracle coverage. Unaligned emitted-WASM tests compare against an
independent byte-based oracle or aligned copied reference state; do not invoke
undefined unaligned C struct accesses merely to create a test oracle.

Inputs and output refer to valid private architectural-register/temporary
storage, disjoint from the helper's argument slots. Exactly 16 destination
bytes may change. Source locations may change only where they alias the
destination. Surrounding bytes, other registers and upper vector lanes remain
unchanged. This is an instruction-helper lowering, with no guest-memory range,
input-content, code-PC or benchmark recognition.

## Backend lowering

Retain the ordinary helper allocator and the three eight-byte pointer argument
slots. `tcg_reg_alloc_call` frees declared call-clobbered registers before
`tcg_out_call`; the backend declares R0/R1 call-clobbered. Use only R0 plus the
existing emitter scratch locals:

| Local | Value |
|---|---|
| `TMP64_LOCAL_0_IDX` | destination pointer `d` |
| `TMP64_LOCAL_1_IDX` | source pointer `a` |
| `REG_IDX(TCG_REG_R0)` | zero-extended original `b[0]`, after loading the third pointer argument |
| `TMP32_LOCAL_0_IDX` | current sigma input |

Load and normalize the `b` pointer, load its first u32, zero-extend that u32 into
R0, then emit the four sequential stores. For words0–2, obtain the sigma input
from `a[word+1]` at the time of that assignment. For word3, wrap R0 to i32 to
recover the saved value. Emit strict i32 `rotr`, unsigned `shr`, XOR and ADD.
Use ordinary i32 loads/stores with conservative alignment hints and the existing
memory32/memory64 pointer-normalization helper. R1–R14 and the R15 call-stack
local are preserved. The output body byte count remains to be measured from
the actual C emitter; an estimate is not a generated-code result.

The matcher requires the original helper function identity, exact name
`sha256msg1`, full void/ptr/ptr/ptr type mask, and absence of
`TCG_CALL_NO_RETURN`. Rejected calls retain the original helper dispatch.
Place emission after `wasm44_defer` and before generic helper dispatch. The
existing RNDS2/PSHUFB paths, TCI fallback, global synchronization, call-argument
stores, unwind bookkeeping for remaining helpers and admission policy stay
unchanged. This pure private-storage path neither suspends nor calls guest
memory helpers.

## Architectural state and faults

`decode-new.c.inc:855` binds opcode `0F 38 CC` to the existing SHA_NI feature
gate. `emit.c.inc:3997` invokes the original three-pointer helper. The common
decoder loads operands1/2 before calling the generator, then performs normal
writeback. A memory source must pass that existing load/fault path before any
inline arithmetic or destination write. Do not bypass it or add direct guest
memory access to this candidate.

The helper does not alter EFLAGS, MXCSR or FP state. Legacy vector upper-lane
behavior, feature faults, instruction decoding, segment/MMU checks, guest fault
PC/address, signal delivery and final writeback remain owned by the unchanged
frontend. Preserve TCI recovery and the original helper for cold/rejected calls.
Source reasoning alone does not establish integrated architectural correctness.

The integrated fixture must warm a real memory-operand MSG1 PC, then cross its
16-byte input into `PROT_NONE`. Verify exact SIGSEGV PC/address/`SEGV_ACCERR`,
unchanged destination and other vectors/upper lanes/flags, and one preceding
observable side effect. The faulting load must add zero successful MSG1 helper
or inline executions. Aggregate counters cannot identify the tier of that
single fault without additional evidence.

## Independent configuration and diagnostic evidence

Use the MSG1-specific ABI rather than reusing MSG2's selector:
`_defuss_m2_msg1_config(enabled)` and `_defuss_m2_msg1_status()`. The
ABI1 state machine mirrors the already-reviewed one-time atomic contract:
0 unset/off,1 selected/off,2 selected/on,3 locked/off,4 locked/on, with
`0x10000` in the status high bits. Default off; one pre-translation selection;
invalid, duplicate or late selection rejected. Lock the choice when the first
helper translation consumes it, including the deferred-emission pass. There
must be no per-execution mode branch or counter in either performance variant.

The first isolated source overlay should start from the retained RNDS2/PSHUFB
engine with MSG2 absent, making the MSG1 effect identifiable. Any later combined
build needs independent selectors and identities for all four MSG1/MSG2 choices,
its own correctness matrix and fresh combined-runtime confirmation. Do not add
or multiply separately observed gains.

A separately named diagnostic build may expose three stopped-read u64 banks:
original-helper entries, compiled-inline executions, compiled-fallback entries.
Fallback is a subset of original; total is original+inline and interpreted is
original−fallback. Counters must not appear in performance modules. Fresh
hot/cold off/on fixtures need exact source-derived counts; every actual Bun SHA
phase under flags3/hot1500 must demonstrate its selected compiled path. Record
JSON/HTTP/integer counts honestly, including zero, and retain boot/between-phase
counts. Never use diagnostic elapsed times for performance selection.

## Required progression

1. Implement the emitter only in a copied source overlay with exact source
   anchors and a frozen manifest; keep the reference helper executable.
2. Extract the original helper for a native oracle and instantiate the actual
   C-emitted WASM in memory32/64 fixtures. Cover arbitrary and boundary u32
   values, all alias partitions, overlaps, sentinels, preserved locals, matcher
   rejection and selector races. The oracle must cache original `b[0]`.
3. Build serially, then run hot/cold off/on ISA and exact diagnostic fixtures,
   including register/memory forms, state preservation and warmed fault recovery.
4. Validate unchanged official Bun plus held-out arbitrary SHA inputs and
   independent capture/restore identities. Prove production-config exposure.
5. Select using a newly declared uninstrumented experiment. Preserve the failed
   MSG2 v1 screen and sustained-v2 results under their original identities.
   Fresh independent confirmation, regression/resource budgets and held-out
   correctness remain prerequisites for a scoped performance claim.

This contract establishes a feasible next implementation path. It does not
complete M2, the remaining M1 attribution gates, M3 regions or product promotion.
