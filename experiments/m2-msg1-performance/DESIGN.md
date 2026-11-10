# MSG1 performance on retained RNDS2

This distinct experiment closes the existing MSG1 performance gap in PLAN.md.
It uses the already reviewed exact scalar lowering and selector unchanged,
with RNDS2/PSHUFB retained, MEMORY64=1, no MSG2, no scalar-lane rewrite, no M3
fusion and no early-operand forwarding. Generated modules have no counters or
mode branch: an atomic pre-translation choice selects off/on once and locks.

The engine study establishes that the fallback uses a native Wasm-to-Wasm
import, not an ordinary JS wrapper. Inlining additionally avoids gen_call's
unwind predicate and the helper-resume bookkeeping. These are source-backed
mechanisms, not measured time fractions or a promise of speedup. Exact partial
alias semantics remain sequential; no unproven SIMD reordering is introduced.

Build the uninstrumented switch source in the same pinned Emscripten 5.0.2 SDK,
with scripts/build.py, x86_64-softmmu, jobs4 and identical memory64 flags to the
matched RNDS2 rebuild. Off/on use the exact same runtime bytes. Original imported
RNDS2 remains a third arm, so a binary-build effect cannot substitute for an
on/off effect. Retained diagnostic/runtime and independent semantic/exposure
reviews are identity-checked; repeat the four hot/cold off/on real Node ISA
fixtures on the new production binary, including the protected-page fault.
Repeat unchanged-Bun Chrome diagnostic exposure before timing.

Freeze exactly six three-arm blocks using all six arm permutations. Primary is
SHA elapsed time: median of the same three 100-call batches per fresh cold VM,
then six paired log ratios with t95 df5. Require ON/OFF and ON/original upper
bounds below1 for a scoped improvement; below.95 for at least5% lower time.
Other workloads, full horizon and startup are descriptive and report every
regression. No pooling with prior candidates or repeated sampling until success.
A promising selected result requires a separately declared fresh confirmation.

Keep unchanged M1 Bun package, ten warmup cycles,69 gates/72 records, no snapshot,
1 vCPU,512 MiB guest,128 MiB TB,2 GiB linear memory,12,000 charged instances,
hotness1500,flags3 and native unwind. Use default Chrome tiering with no profiler
or debugger. Builder must be stopped for all timing. Capture deadline30minutes;
retain failures/outliers, halt on failure, and keep all scratch under defuss-vm/tmp.

Promotion budgets remain5% other-workload/startup/horizon time,1% Wasm file size,
5% peak process memory/service latency, unchanged hard memory/instance limits.
Peak process memory, service latency, held-out apps and other platforms remain
separate acceptance work; passing this study does not automatically promote.
