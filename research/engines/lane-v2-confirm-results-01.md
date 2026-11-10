# Scalar-lane v2 independent confirmation

All 18 fresh Chrome launches passed the unchanged Bun correctness protocol and
cleanup. Input hashes, raw serial reconstruction, lifecycle replay and nonce
independence checks passed. All six arm permutations were used.

| Time ratio | Geometric mean | Marginal 95% interval |
| --- | ---: | ---: |
| Candidate / original RNDS2, SHA primary | 0.990373 | 0.910182–1.077630 |
| Candidate / matched rebuild, SHA primary | 0.980769 | 0.951445–1.010997 |
| Candidate / original, full horizon | 0.975808 | 0.902486–1.055087 |
| Candidate / matched rebuild, full horizon | 0.952621 | 0.862402–1.052278 |

The predeclared primary failed to establish improvement against either reference.
The smaller emitted code and passing correctness do not establish a speed gain.
The earlier exploration and this confirmation remain separate. Do not add
repetitions to this candidate until it passes. No runtime is promoted.

Integer timings varied sharply even in unchanged arms (control/original block
ratios ranged from 0.163 to 6.446). These captures are retained. We have no
per-TB outer V8 tier or guest JSC tier observations proving the cause, and we do
not attribute this variation to external load, deoptimization or RNDS2.

Evidence: artifacts/rnds2-lanes-v2-confirm-analysis-01/analysis.json;
artifacts/rnds2-lanes-v2-confirm-plan-01/plan.json. The next independent experiment
is the existing memory32-address profile on original RNDS2, not a combination
with the unproven scalar-lane rewrite.
