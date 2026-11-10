# Fresh idle-host M3b timing exploration

User requested a new measurement against the original baseline on 2026-11-08,
reporting zero unrelated host load. Preserve previous load-affected FIFO sets.

Compare original RNDS2 bytes, new current M3b timing build OFF, and the same
build ON. Four independent blocks use original/OFF/ON, ON/OFF/original,
original/OFF/ON, ON/OFF/original. Exactly twelve fresh cold launches, no snapshot
migration (unsupported by the restricted M3b profile), no retries or discarded
slow results. All arms use identical restricted devices, one vCPU, 512 MiB,
128 MiB TB buffer, hot limit 1500, flags 3, cap 12000, unchanged original M1
Bun bundle/initramfs, ten warmup cycles and three 100-call batches per each of
integer, JSON, SHA256 and HTTP. Thirty-minute per-capture deadline plus outer
grace. No compiler VM or other owned heavy work overlaps measurement.

The accepted ABI2 source is copied and fingerprinted. Remove M3a/M3b counters,
watch scans, context census and forced-boundary diagnostic IR, retaining native
interrupt polling, service-debt payment, graph restrictions, eligibility,
generation, invalidation and instance guards. Preserve structure layouts and
all unrelated files. No code-attribution observer is included. Read-only
profile status is checked at every gate; no hot-path instrumentation is added.
This is an uninstrumented experimental build, not a promoted production build.

Use browser monotonic time from ACK immediately before cont to first completed
result marker; record result-to-stop and full start-to-final-stop separately.
No subtraction of protocol overhead. Validate every result with the existing
strict M1 protocol. Retain a fsynced serial/observation journal before ACK.
Each fresh launch is one independent unit; its three same-workload batches
are summarized by the median. Analyze whole-block paired candidate/control
log ratios, geometric estimates and exact small-sample Student-t 95% intervals
(df=3, t=3.182446305284263); exploratory intervals, no multiple-endpoint promotion
claim. Primary integer endpoint, plus all other workloads and full horizon.
Also compare current ON/OFF to separate fusion from base/guard overhead.
Host load is observed prospectively; do not substitute older loaded results or
compare unlike cold timings to the historical snapshot/native ratio as causal
evidence. Runtime export rejection, source stability and all correctness
checks must pass. Failed launch halts the campaign and remains retained.
