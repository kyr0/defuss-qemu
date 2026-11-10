# MSG2 sustained-v2: correct execution, failed selection

The four-pair exploration did not select MSG2 for confirmation. All eight fresh
captures passed their workload and protocol checks: 25,600 measured calls and
16,000 warmup calls. The unchanged operation source, pinned Bun image, shared
runtime bytes and alternating pair order were retained. The compiler VM was
stopped throughout. No completed observation was excluded or replaced.

| Endpoint | Descriptive candidate/control ratio |
| --- | ---: |
| SHA256 | 0.9807 |
| Integer | 0.9654 |
| JSON | 1.0396 |
| Guest-loopback HTTP | 0.7966 |
| Readiness | 0.9794 |
| Empty-gate p95 | 1.5915 |
| Maximum result-to-stop tail | 1.1036 |

These are exploratory ratios, not confirmed improvements. SHA did not meet the
0.95 selection margin. Twenty-one of the 32 VM/endpoint drift checks failed
the predeclared bound. The prospective variance calculation required 344
confirmation pairs, exceeding the declared maximum of 32; it was not clamped.
There will be no confirmation under this plan and no retry of the same screen.
The [analysis](../../artifacts/m2-sustained-v2-exploration-analysis-01/analysis.json)
and [independent review](../../artifacts/m2-sustained-v2-exploration-review-01)
retain the complete decision and raw evidence identities. The earlier failed
v1 screen remains a separate result.

## What the lifecycle observations establish

All eight VMs reached the 12,000-instance charged cap and subsequently showed
a net charge drop during measured execution. Integer maxima of 5.623–9.407 s
and JSON maxima of 12.308–14.749 s occurred between those observations. Both
the [descriptive diagnosis](../../artifacts/m2-sustained-v2-pool-diagnosis-01/review.json)
and [independent source/data audit](../../artifacts/m2-sustained-pool-audit-01/review.json)
retain all 416 warmup and measured rows.

The source retires old instances only after reservation fails. Unlinking does
not release the charge; consumption of completed GC callbacks does. Retired
entries also face the existing admission thresholds when promoted again.
Sparse stopped observations do not assign the elapsed time among these causes,
compilation, host memory pressure or other work. They justify investigating
pool lifecycle behavior before another throughput experiment.

## Correctness and resource evidence remain valid

Four exact-count instruction fixtures passed with hot/cold and off/on paths.
Production-config Bun diagnostics independently established 59,040,000 MSG2
executions in each mode's measured SHA phases, including 58,730,524 compiled
inline executions when enabled. Measured integer, JSON and HTTP phases recorded
zero MSG2 executions. Held-out capture/restore checks also passed. These prove
semantic and execution-path coverage; diagnostic times are ineligible for
performance decisions.

The separate matched sustained resource pair passed. Cumulative instantiated
module input was 17,592,357 bytes for control and 17,637,567 for candidate:
ratio 1.00257, within the declared 1.10 descriptive budget. The
[independent resource review](../../artifacts/m2-resource-v2-review-01/review.json)
verified 149 identities, including snapshots and raw protocol records. This is
cumulative module input, not native JIT resident memory, true peak host memory,
or a long-run bound. Phase allocations must not be treated as intrinsic code
size per operation.

MSG2 remains an isolated, default-off experiment. No production promotion or
whole-application speedup is established. A different pool policy requires its
own correctness gates, frozen prospective experiment and fresh measurements.
