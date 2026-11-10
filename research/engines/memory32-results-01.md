# Memory32 address-profile result

All eighteen cold Chrome launches passed the unchanged Bun protocol, input
identities, raw serial reconstruction, Python/JS lifecycle replays and cleanup.
No capture was discarded. Six blocks used all six three-arm permutations.
The builder was stopped throughout the timing campaign.

The predeclared full-horizon primary did not improve. The candidate took more
time than the matched rebuild and exceeded the 1% binary-growth budget.

| Time ratio | Geometric mean | Marginal 95% interval |
| --- | ---: | ---: |
| candidate/original, horizon | 1.064766 | 0.969116–1.169857 |
| candidate/control, horizon | 1.123321 | 1.048311–1.203698 |
| candidate/original, sha256 | 1.023257 | 0.907492–1.153791 |
| candidate/control, sha256 | 1.063033 | 1.015445–1.112851 |
| candidate/original, ready | 1.102425 | 1.021029–1.190311 |
| control/original, horizon | 0.947874 | 0.903779–0.994120 |

JSON candidate/control was 1.075280 [1.007869,1.147199]. Other endpoint details
and all block ratios remain in the raw analysis. These are marginal intervals;
secondary endpoints do not replace the primary. The rebuild's apparent 5.2%
horizon gain is a selected secondary result, motivating a distinct twelve-launch
confirmation. It is not credited to the memory32 profile or a code optimization.

The candidate Wasm is 13,833,060 bytes versus 13,232,981 original (+4.53%) and
13,229,187 matched rebuild. Every capture retained 2 GiB linear memory; maximum
observed charge was 11,506 under the unchanged 12,000 cap. Per-VM peak RSS,
service latency, held-out applications and cross-platform acceptance remain open.

Correctness was separately established in native guard/helper checks, hot and
cold RNDS2 fixtures (28,672 each), production PSHUFB (34,816), setup (20,480),
RNDS2 (28,672), and 40,960 extracted-emitter comparisons. The separate Bun
exposure capture observed [857909 native,156582091 inline,0 compiled fallback]
RNDS2 executions in measured SHA phases. Counts are not elapsed-time fractions.
The patched memory32 packaging retained the exact successfully linked bytes;
attempt 01 remains failed and package 02 is separately identified. Native unwind
and strict table-index patching passed. The production baseline is unchanged.

This outcome rejects projecting Node's component code-size reduction onto the
Chrome VM. The newer checked-out Chrome V8 already makes small-offset memory64
checks cheaper, and this whole profile also adds pointer/table conversions.
Those source findings describe possible mechanisms, not a causal attribution
of the measured regression. Per-TB V8/JSC tiers remain unobserved.

Evidence: artifacts/memory32-rnds2-timing-analysis-01/analysis.json,
artifacts/memory32-rnds2-timing-plan-01/plan.json and
artifacts/memory32-rnds2-exposure-01/exposure.json.
