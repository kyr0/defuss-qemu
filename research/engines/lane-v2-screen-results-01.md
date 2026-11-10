# Scalar-lane v2 cold screen

All twelve fresh Chrome launches, input/cleanup checks and Python/JS raw
lifecycle replays passed. The primary SHA endpoint is inconclusive.

| Comparison, time ratio | Geometric mean | Marginal 95% interval |
| --- | ---: | ---: |
| Candidate / retained RNDS2, SHA | 0.962375 | 0.858764–1.078487 |
| Candidate / matched rebuild, SHA | 0.964818 | 0.910433–1.022451 |
| Candidate / retained RNDS2, full horizon | 0.989318 | 0.8873–1.1030 |

Candidate/original SHA ratios by block were 0.9861, 1.0062, 0.9994, 0.8650.
Do not interpret the 3.8% point estimate as an established speedup. Integer's
secondary original-relative interval happened to lie just below one, but the
unchanged rebuild was also faster in its point estimate and the separate
diagnostic observed no RNDS2 exposure in that phase. It is not evidence that
this SHA lowering accelerated integer arithmetic. No endpoint is substituted
for the declared SHA primary, and no runtime is promoted.

A separate diagnostic passed the unchanged Bun protocol with SHA counts
[80634 native, 157359366 compiled inline, 0 compiled fallback subset]. Other
measured workloads had zero RNDS2 counts. Counts do not measure elapsed cost.

The small apparent SHA gain motivates a bounded, independent six-block
confirmation, declared under benchmarks/harness/rnds2-lanes-v2-confirm. It
uses all six arm-order permutations and reuses exact frozen measurement inputs.
Exploration and confirmation are reported separately, never pooled.

Evidence: artifacts/rnds2-lanes-v2-timing-analysis-01/analysis.json and
artifacts/rnds2-lanes-v2-exposure-01/exposure.json.
