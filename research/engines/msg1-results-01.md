# MSG1 timing result, 2026-11-08

VERIFIED: All eighteen fresh captures passed the unchanged guest oracle,
input-identity checks and owned-browser cleanup. The analysis replayed the
raw journals in Python and the retained JavaScript oracle. The six blocks
cover all six orders of original RNDS2, MSG1 OFF and MSG1 ON. OFF and ON use
the same production binary. The four captures from the administratively
interrupted study remain separate and are not pooled.

The primary SHA ratio is below one at its point estimate, but neither required
95% interval excludes one. This study does not establish an improvement above
RNDS2 and does not authorize promotion.

| Comparison | SHA time ratio | Paired 95% interval | Full-horizon ratio | Paired 95% interval |
| --- | ---: | --- | ---: | --- |
| MSG1 ON / original RNDS2 | 0.860868 | 0.677976 to 1.093097 | 0.915903 | 0.706234 to 1.187820 |
| MSG1 ON / MSG1 OFF | 0.801346 | 0.581959 to 1.103438 | 0.824765 | 0.551678 to 1.233035 |

Each SHA observation is the median of three unchanged 100-call batches in
one fresh VM. Intervals use the prespecified paired log Student t calculation
over six blocks, with five degrees of freedom. The full horizon and other
workloads are descriptive secondary measurements. All their ON/original and
ON/OFF intervals also include one. No secondary result replaces the primary.

VERIFIED: This was a loaded-host study. Aggregate host CPU occupancy across
capture intervals ranged from 71.18% to 86.71%, with median 80.08%; observed
one-minute load averages ranged from 13.80 to 27.33 on eighteen CPUs. Those
observations do not establish a compiler deoptimization. The build VM and
preview service stayed stopped, and no other project VM or build ran alongside
the campaign. The thirty-minute per-capture deadline was unchanged.

VERIFIED: The candidate Wasm file is 0.1702% larger than original RNDS2,
within the 1% file-size budget. Linear memory remained 2 GiB and the largest
observed charged instance count was 11,787, below the 12,000 limit. Peak
process memory, service latency, a held-out application and other platforms
remain unmeasured acceptance gates.

The next work follows the user's revised priority: investigate actual sampled
hot paths and their source mechanisms before selecting another optimization.
This result does not trigger an automatic old-plan successor or an extension
of the timing sample.

Evidence: [analysis](../../artifacts/m2-msg1-timing-analysis-02/analysis.json),
[host-load derivation](../../artifacts/m2-msg1-host-load-01/report.json),
[frozen plan](../../artifacts/m2-msg1-timing-plan-02/plan.json),
[completion receipt](../../artifacts/m2-msg1-timing-02/complete.json),
[interruption record](../../artifacts/m2-msg1-interruption-01/report.json).
