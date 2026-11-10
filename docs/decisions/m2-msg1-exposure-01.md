# MSG1 exposure in the unchanged Bun workload

The separate MSG1 candidate passed real Chrome off/on captures of the original
M1 Bun bundle, operation sources, guest filesystem and expected answers. Both
runs used the existing MSG1 diagnostic runtime with runtimeFlags3, hotLimit1500,
one vCPU,512MiB guest RAM and128MiB translation buffer. The compiler VM was
Stopped before and after each serialized capture. An explicit30-minute
diagnostic deadline accommodated the user-reported heavy host load.

Both arms passed all69 gates and12 measured results. The
[comparison](../../artifacts/m2-msg1-exposure-analysis-01/analysis.json) and
[independent review](../../artifacts/m2-msg1-exposure-review-01/review.json)
passed; the latter binds222 identities and independently replays raw serial,
pre-ACK records, source/package/runtime proofs, maps, compressed and raw snapshot
hashes, and the complete unsigned64-bit counter partition.

| Three measured SHA phases | Off | On |
|---|---:|---:|
| Interpreted MSG1 helper executions |324287|326293|
| Compiled fallback executions |58715713|0|
| Compiled inline executions |0|58713707|
| Total MSG1 executions |59040000|59040000|

Every SHA phase used its selected compiled path. Integer, JSON and HTTP measured
intervals recorded zero MSG1. The whole-run total was61009932 per arm, including
1968000 warmup executions,948 interpreted boot executions and984 compiled
executions between phases. The tail was zero. Inclusive stopped boundaries
also cover guest framing and stop delivery; they do not assign every instruction
to a particular Bun library.

The original instruction lowering and runtime were not changed. The exposure
adapter has a frozen source review and13 passing focused tests; its independent
reviewer has six passing corruption tests. All packages, captures, source
freezes and review evidence remain separate from MSG2 and passive FIFO.

This closes the MSG1 production-configuration exposure check. Instrumentation
makes these captures ineligible for timing comparisons. MSG1 still needs its
own uninstrumented performance and resource work, held-out application checks
and a fresh independent confirmation before any promotion. Reported host load
also prevents attributing timing changes to optimization or deoptimization.
