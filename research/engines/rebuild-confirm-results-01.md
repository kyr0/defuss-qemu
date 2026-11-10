# Unchanged-source rebuild: independent confirmation failed

All twelve fresh Chrome cold launches passed the unchanged Bun workload,
input checks, raw serial/lifecycle replay and cleanup. Six paired blocks
alternated order. No launch was removed or repeated; selecting data were
not pooled into the confirmation.

| Rebuild / original RNDS2 time | Geometric mean | Marginal 95% interval |
| --- | ---: | ---: |
| Full horizon, predeclared primary | 1.048080 | 0.951254–1.154762 |
| SHA-256, descriptive | 1.004674 | 0.925207–1.090966 |
| JSON, descriptive | 1.055025 | 0.940798–1.183121 |
| Integer, descriptive | 1.067548 | 0.965258–1.180678 |
| HTTP, descriptive | 1.042380 | 0.938269–1.158043 |
| Ready time, descriptive | 1.091826 | 0.959024–1.243018 |

The earlier selected 5.2% point-estimate gain did not reproduce. Neither a
speedup nor a horizon regression is established by the confirmation interval.
No new optimization or binary is promoted, and this hypothesis will not be
extended until significant. The imported original RNDS2 remains the baseline.

All captures kept 2 GiB linear memory and the 12,000 instance cap, with maximum
observed charge 11,502. This does not close peak RSS, service-latency, held-out
or cross-platform release gates. These are matched cold-protocol results, not
updates to the historical RNDS2-versus-PSHUFB snapshot-replay figures.

Evidence: artifacts/rnds2-rebuild-confirm-analysis-01/analysis.json and
artifacts/rnds2-rebuild-confirm-plan-01/plan.json. The next distinct planned
work is MSG1's still-open uninstrumented performance comparison, using off/on
selection within one binary and original RNDS2 as a third arm. It does not
combine the rejected memory32 profile, scalar-lane rewrite or MSG2.
