# Fresh M3b timing against the original RNDS2 baseline

The current M3b candidate is **slower in this fresh matched experiment**. With fusion ON, the full cold workload sequence took **18.31% longer**, integer work used **3.649× the time**, and JSON took **19.80% longer** than the original RNDS2 baseline. SHA256 and HTTP did not show a clear difference within the observed variation. All four blocks had ON/original ratios above one for integer, JSON and the full sequence. This is a documented no-gain exploratory result; M3b remains default off and is not promoted.

The user requested new timing on 2026-11-08 and reported no unrelated host load. Twelve new launches ran serially from 08:09:30 to 08:23:47 UTC. The compiler VM was stopped at 08:08:30 UTC and was checked before and after every launch. There were no failed captures, discarded observations, retries or replacement runs. Earlier load-affected FIFO sets remain unchanged and are not pooled with this experiment.

## Matched results

Each run contributes the median of its three 100-call batches for each workload. Displayed absolute times are medians across four independent launches per arm. Ratios are geometric means of the four paired launch ratios, so they are not ratios of the displayed medians. Smaller ratios are better.

| Endpoint | Original RNDS2 | Current OFF | Current ON | ON/original ratio | Nominal 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| Integer, 100 calls | 429.407 ms | 864.517 ms | 1933.452 ms | 3.649459 | 1.580880–8.424769 |
| JSON, 100 calls | 3130.180 ms | 3472.425 ms | 3833.675 ms | 1.198012 | 1.075823–1.334079 |
| SHA256, 100 calls | 2238.638 ms | 2204.087 ms | 2295.242 ms | 1.016618 | 0.885458–1.167207 |
| Guest-loopback HTTP, 100 calls | 3462.920 ms | 3792.718 ms | 3686.670 ms | 1.059927 | 0.857671–1.309879 |
| Full cold sequence | 64.794 s | 71.946 s | 74.428 s | 1.183093 | 1.095924–1.277195 |
| Cold readiness | 24.924 s | 30.041 s | 29.755 s | 1.206363 | 1.072018–1.357544 |

These are prospective four-block exploratory estimates with paired log Student-t intervals (df=3, critical value 3.182446305284263). Intervals assume a suitable log-ratio model, are marginal rather than family-wise, and do not constitute frozen independent performance confirmation. Nested batches are not counted as independent launches. No protocol overhead is subtracted.

## What OFF separates

The clean current OFF runtime already used **2.2536×** the original integer time (nominal interval 1.5264–3.3273) and **14.28%** more full-sequence time (interval 1.0680–1.2228). This establishes an observed cost in the current base/guarded runtime even with fusion disabled; it does not isolate which guard or other source/build difference causes that cost.

ON/OFF integer time had a 1.6194 ratio but a broad 0.8068–3.2502 interval. Block 3 favored ON relative to OFF. Thus the separate integer effect of fusion is variable, despite ON being slower than the original in every block. ON/OFF full sequence was 1.0353 (1.0022–1.0695), still exploratory. No hot execution counters were enabled in these measurements, so the timing alone does not identify each run's actual fused code exposure or JSC tier.

| Block / order | Integer original (ms) | Integer OFF (ms) | Integer ON (ms) | ON/original | ON/OFF | Full sequence ON/original |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / original→OFF→ON | 411.015 | 855.060 | 1867.445 | 4.543496 | 2.183993 | 1.243153 |
| 2 / ON→OFF→original | 428.135 | 873.975 | 1999.460 | 4.670162 | 2.287777 | 1.169749 |
| 3 / original→OFF→ON | 454.525 | 853.655 | 755.820 | 1.662879 | 0.885393 | 1.112308 |
| 4 / ON→OFF→original | 430.680 | 1392.825 | 2165.140 | 5.027259 | 1.554495 | 1.211246 |

## Exact scope and validation

- The original control uses the byte-identical imported RNDS2 runtime from `manifests/runtime-baseline.json`, WASM SHA256 `ecfbc2b4efa6cffaf2b1a22e2d511f6a1e429c6f70c98aafe665176712c8bad4`.
- Current OFF and ON share one new observation-free runtime. It derives from accepted M3b ABI2 source, removing counters/watch scans, context census and the forced-boundary diagnostic IR selector. Native interrupt polling, service-debt payments, graph restrictions, fixed limits, descriptor layouts, invalidation and entry guards are retained. All other files are byte-identical. Full before/after source inventories and actual emitted export checks passed.
- All arms use identical restricted PC devices, one vCPU, 512 MiB guest RAM, 128 MiB TB buffer, hot threshold 1500, runtime flags 3 and hard instance cap 12000. There is no snapshot migration, AOT, combined MSG1/MSG2 or FIFO candidate. This measures the current M3b experiment, not a combined promoted product.
- The original M1 Bun app and initramfs are unchanged: app SHA256 `31d28add91e5a78aee775e57a365828f2b75843fc9bbd26b66bfe06e9d4717d5`, initramfs SHA256 `d54f7ed772e0249f6e6d52c7d795a9cd566a378555dbc7f7961aed830b3bd2c6`. Ten warmup cycles precede three 100-call batches of each original workload.
- Chrome 157.0.8103.38 and Node 26.11.1; pinned offline Emscripten 5.0.2 build. Thirty-minute inner capture deadlines and 35-minute outer watchdogs; none fired.
- Every capture passed 69 gates and 12 results. Total: **828 gates, 144 measured batches, 14,400 checked measured calls and 480 warmup calls**, with twelve distinct guest nonces. Browser cleanup passed after every capture.
- Guest timing uses browser monotonic time from ACK immediately before continue to first complete result marker, including serial/control overhead. Full sequence starts immediately before the runtime factory and ends at final confirmed stop; it includes boot, warmup, all measured work and stopped journal/ACK gaps. Asset fetch and JS import precede that boundary. Readiness is cold, without snapshot capture.
- Raw serial chunks and observations were fsynced before every ACK. Python reconstructs timing/results and JS separately replays the strict original protocol. The supplemental audit checked **523 identities and 336 archived source files**. This is same-author cross-implementation verification, not external independent authorship.

Host-wide CPU idle averaged 63.48%–87.09% over the available per-run sampling windows, **including the benchmark itself**. One-minute load observations ranged 2.579–10.559. These aggregate values do not partition unrelated activity from this benchmark; the user's idle-host statement describes the start condition, not a continuous zero-load guarantee. No owned build or second measured VM overlapped. All run variation is retained, including the much faster third ON integer observation and the slower fourth OFF observation.

The historical PLAN comparison used snapshot-restored execution and a different readiness boundary. Its original integer median was 412.893 ms; the fresh matched control median here is 429.407 ms. Historical JSON/SHA/HTTP and native-gap figures remain historical: no new native VM or snapshot-restore measurement was performed. The causal comparison in this report is the fresh matched original/OFF/ON campaign.

## Analysis correction and retained evidence

The frozen first Python analyzer failed an exact serial comparison because `Path.read_text()` normalized CRLF while raw JSON chunks retained it. The original analyzer and failure are preserved. A separately bound `analyze-v2.py` decodes UTF-8 bytes without newline conversion at two read sites; endpoint definitions, all observations and statistical formulas are unchanged. The corrected replay passed without any VM rerun. The supplemental audit initially expected an obsolete `singlestep` QMP field; before acceptance its exact expected object was corrected to the actual `{status:"paused",running:false}` schema. No runtime guard or measurement was relaxed.

- [Prospective design](../../experiments/m3b-timing/DESIGN.md) and [frozen plan](../../artifacts/m3b-idle-timing-plan-01/plan.json).
- [Native derivation](../../artifacts/m3b-timing-source-01/overlay.json), [build report](../../artifacts/m3b-timing-build-01/build-report.json), and [source/export/host-test validation](../../artifacts/m3b-idle-timing-plan-01/validation.json).
- [All raw captures](../../artifacts/m3b-idle-timing-01) and [completed schedule](../../artifacts/m3b-idle-timing-01/complete.json).
- [Failed first analyzer](../../artifacts/m3b-idle-timing-analysis-execution-01/execution.json), [reader correction](../../artifacts/m3b-idle-timing-analysis-derivation-02/derivation.json), [passed analysis and all ratios](../../artifacts/m3b-idle-timing-analysis-02/analysis.json), and [passed supplemental audit](../../artifacts/m3b-idle-timing-review-01/review.json).

## Plan consequence

M3b now has a documented uninstrumented no-gain result, satisfying the timing-evidence portion of its exit criteria within this restricted scope. M3b remains partial because its other semantic/resource gates remain open. The next performance investigation should isolate the current OFF overhead and explain run-to-run fused exposure before widening regions or changing defaults. Redundant entry/context checks and repeated native-to-JS eligibility checks are source-level hypotheses only; this campaign does not measure their exclusive cost and does not authorize weakening them.
