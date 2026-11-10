# RNDS2 with memory32 addressing

This experiment changes only the existing configure option
`--wasm64-32bit-address-limit` on the unchanged retained RNDS2 source.
Emscripten MEMORY64=2 preserves the wasm64 C ABI, then Binaryen lowers linear
memory addresses to memory32. It does not make the emulated x86 guest 32 bit.

Hypothesis: reducing outer V8 memory64 bounds-check work can help the whole VM.
This remains an empirical question: inserted pointer wraps, code size and JIT
behavior may offset it. The source branch already normalizes generated TB loads
and stores and changes function-table index representation. Verify both the main
runtime and generated TBs by executing real guest correctness fixtures.

Retain 2 GiB linear memory, 512 MiB guest RAM, 1 vCPU, 128 MiB TB cache,
12,000 charged instances in Chrome, hot threshold 1500, flags 3, native unwind,
Asyncify, original RNDS2 lowering and the unchanged M1 Bun guest package.
The mode2 branch has a smaller budget only when the *outer host* is Bun/JSC;
Bun running in the Chrome-hosted guest must not activate that branch.
No claim for host memories above 4 GiB or for outer Bun/JSC performance.
This is a whole addressing-profile comparison: memory/table lowering and JS
function-table index conversions change together. Do not attribute any whole-VM
speedup exclusively to bounds-check removal.

Build production and an untimed diagnostic derivative with the exact pinned
Emscripten 5.0.2 SDK, flags, optimization and jobs=4 of the matched memory64
control. The new build driver is a copy of scripts/build.py with root/import
plumbing, the one configure flag and a profile label; retain its diff.
Run native guard/helper selftests, hot/cold RNDS2 oracle, PSHUFB, setup and
production RNDS2 guest fixtures before unchanged Bun exposure and timing.

Timing will use fresh original/control/candidate captures in six complete
three-arm blocks with all six order permutations, 30-minute capture deadline.
Predeclared primary is full protocol horizon (runtime start through final completion gate),
with four workload medians and ready time reported separately. Retain every
capture and outlier. Paired log t 95% with six independent blocks, df=5.
Require primary upper bound below 1 against BOTH references for a scoped gain;
below .95 for a gain of at least 5%. Secondary intervals are descriptive.
No pooling with lane or setup studies. Remaining service, memory/RSS, held-out
and cross-platform acceptance stays open; no automatic baseline replacement.

Reference: https://emscripten.org/docs/tools_reference/settings_reference.html#memory64
The toolchain is pinned; the experimental mode is not a future SDK support claim.

Packaging follow-up: compilation/link of attempt 01 succeeded, but the legacy
JS patcher rejected `wasmTable.get(Number(idx))`. Attempt 01 stays failed and
immutable. Production package 02 reuses the exact linked Wasm bytes with a
separate strict memory32 patcher; build-v2.py applies the same adapter to the
diagnostic build. The adapter changes only this table-index syntax and locates
the unchanged helper/unwind runtime sources. It retains direct Wasm helper
imports when instrumentation is off. No failed build is relabeled as passed.

The candidate Wasm file is 13,833,060 bytes, exceeding the predeclared 1%
file-size growth promotion budget (original 13,232,981 bytes; +4.53%). This
resource gate has failed. Correctness and scoped performance measurements
continue, without automatic promotion or relaxing that budget.
