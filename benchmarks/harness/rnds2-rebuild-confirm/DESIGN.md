# Independent confirmation of the unchanged-source rebuild

The memory32 experiment failed its horizon primary. Its unchanged RNDS2 rebuild
reference had a secondary control/original horizon ratio of 0.947874 with a
marginal 95% interval 0.903779–0.994120. That selected exploratory finding does
not establish a reproducible gain; earlier studies showed uncertain ratios.
Do not credit any new lowering, fusion or memory profile for this difference.

Run exactly six fresh paired blocks, twelve cold launches: original/control,
control/original, repeated three times. Reuse the exact frozen measurement
runner, immutable binaries, original M1 Bun package, 10 warmup cycles,
three 100-call batches per workload, 512 MiB/1 vCPU/128 MiB TB, 2 GiB linear
memory, 12,000 charged instances, hotness1500/flags3, native unwind and default
Chrome tiering. No builder/profiler/debugger or snapshots during captures.
Thirty-minute capture deadlines; retain every attempt and halt on failure.

Primary is full protocol horizon, with six independent paired log ratios and
Student t 95% interval (df5). Upper bound below 1 establishes a scoped gain;
below .95 is needed to claim at least 5% lower time. Secondary workload and
startup intervals are descriptive. Never pool the selecting study, retry until
significant, or substitute an endpoint. Confirmed binary timing does not explain
its cause or finish held-out/resource/platform acceptance. No automatic runtime
replacement or milestone promotion.

Both source fingerprint and SDK identities are retained. Original imported
binary and freshly built reference are different bytes; the source-level
reason for any performance difference is unproven. If confirmation fails,
retain it and do not keep extending this same selected hypothesis.
