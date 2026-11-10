# RNDS2 plus SIMD setup: first engine-guided screen

All twelve cold launches passed. Raw serial reconstruction, both lifecycle
oracles, input identities and owned-browser cleanup passed.

Candidate / retained RNDS2 time ratios, four paired launch blocks:

| Metric | Geometric ratio | Marginal 95% interval |
| --- | ---: | ---: |
| Integer | 0.596 | 0.167–2.121 |
| JSON (primary) | 1.034 | 0.525–2.034 |
| SHA-256 | 0.989 | 0.669–1.461 |
| HTTP | 1.083 | 0.685–1.713 |
| Full horizon | 1.030 | 0.968–1.096 |

Candidate / same-command unchanged rebuild was 1.192 for JSON and 1.071 for
SHA-256, also inconclusive. No demonstrated gain and no promotion. These
results do not establish that the selected SIMD setup was the dominant cost.
The separate diagnostic confirmed substantial JSON and SHA exposure, but
execution counts are not elapsed-time fractions.

Pool charges stayed below 12,000 in every capture (final range 11,318–11,578);
the instance cap was not reached. An opportunistic process snapshot at
09:28:07 UTC observed competing host activity. All launches remain included;
none was discarded or replaced because of timings or load. This observation
does not provide per-process exclusive cost attribution or explain all noise.

Evidence: artifacts/rnds2-setup-timing-analysis-01/analysis.json,
artifacts/rnds2-setup-exposure-01/exposure.json, and
artifacts/rnds2-setup-host-observation-01.json. Frozen plan and source remain
unchanged. A different prospective candidate will use fresh labels.
