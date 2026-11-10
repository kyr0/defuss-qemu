# Passive FIFO: three load-affected exploratory sets

The requested three sets are now retained. Set01 permanently halted; sets02 and03 each completed four fresh pairs and passed their frozen analysis and independent replay. Their candidate/control full-horizon geometric ratios are **1.582245** and **1.437645**. These are descriptive observations under user-reported massive host load, whose onset and end are unknown. They do not establish causal optimization or deoptimization, confirmation, or production acceptance. No pooled estimate, best-set selection, replacement of set01 or fourth set is made.

| Set | Capture deadline | Completed / planned | Failed after start | Unstarted | Complete-set H ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| 01 | 600 s | 2 / 8 | 1 | 5 | Unavailable |
| 02 | 1,800 s | 8 / 8 | 0 | 0 | 1.582245 |
| 03 | 1,800 s | 8 / 8 | 0 | 0 | 1.437645 |

There are **18 completed captures, one failed capture and five unstarted steps**, across19 distinct started capture nonces. This is not a completed12-pair/24-capture experiment. Each complete later set has AB/BA/AB/BA order (A=control/OFF, B=candidate/ON); no completed observation or slow batch was discarded.

The [prospective deadline amendment](../../artifacts/passive-fifo-deadline-amendment-01.json) has SHA-256 `1edd9eafcc3df1525718bb691d9cd637f005d2385acdb9f04ad1e78eee86d5ca`. It changed only the operational deadline for the two remaining sets, with the existing20-second outer grace. The30-minute choice was an **assistant default after an unanswered optional clarification**, with `explicitUserAnswer:false`; it was not explicit user deadline approval. The original failed set and both unexecuted10-minute future plans remain unchanged. The [original repetition declaration](../../artifacts/passive-fifo-timing-repetitions-01.json) describes intended work, not a claim that all24 captures completed.

Every capture uses the same finite workload:20 prelude and32 subsequent100-call batches, identical operation/input/result rules, unchanged packages, runtime and numerical margins. H spans the browser timestamp immediately before VM startup through the completed final stopped validation. It includes startup/snapshot/calibration, all52 ACK-to-result intervals, all51 gaps and the final tail. No prelude, gaps or service cost is subtracted, and no plateau is assumed.

All available paired H values are below. Absolute durations are seconds rounded to three decimals; ratios are candidate/control. Set01 pair1 is retained only as a complete pair inside a permanently invalid incomplete campaign.

| Set / pair | Order | Control H (s) | Candidate H (s) | H ratio |
| --- | --- | ---: | ---: | ---: |
| 01 / 1 | OFF→ON | 388.660 | 485.281 | 1.248601965 |
| 02 / 1 | OFF→ON | 391.652 | 601.632 | 1.536138358 |
| 02 / 2 | ON→OFF | 405.130 | 551.176 | 1.360492237 |
| 02 / 3 | OFF→ON | 360.505 | 536.437 | 1.488016936 |
| 02 / 4 | ON→OFF | 213.863 | 431.019 | 2.015399142 |
| 03 / 1 | OFF→ON | 300.650 | 560.209 | 1.863324285 |
| 03 / 2 | ON→OFF | 248.816 | 366.933 | 1.474715669 |
| 03 / 3 | OFF→ON | 228.214 | 308.932 | 1.353696567 |
| 03 / 4 | ON→OFF | 425.685 | 488.852 | 1.148389279 |

Each complete-set endpoint below is the geometric mean of its four **paired ratios**, not the ratio of two arithmetic means. All nine endpoint estimates are retained. The full-H set estimates span1.437645–1.582245; that spread is not a confidence interval.

| Endpoint | Set02 geometric ratio | Set03 geometric ratio |
| --- | ---: | ---: |
| Full H | 1.582245380 | 1.437645466 |
| Sum of all52 phase times | 1.674313156 | 1.576127330 |
| Integer total, all13 batches | 5.293067474 | 3.201795436 |
| JSON total, all13 batches | 1.795782029 | 1.836134794 |
| SHA-256 total, all13 batches | 1.205776523 | 1.210450283 |
| HTTP total, all13 batches | 1.137508355 | 1.055023752 |
| Readiness elapsed | 1.155721887 | 0.893945790 |
| Empty-gate p95 | 1.829398542 | 1.486329260 |
| Maximum result-to-stop, all52 batches | 0.903114948 | 0.531244176 |

**No confidence intervals or upper bounds were produced for either exploratory set.** Their actual endpoint JSON contains only `ratios` and `geometricMean`. The frozen `REPORT.md` footer refers to Bonferroni upper bounds, and the earlier reporting outline anticipated intervals; that wording does not describe these exploratory outputs. Those frozen files are preserved. Both actual outputs have `selected:false`, `confirmationPassed:false` and `productPromotionEligible:false`. Their automatic variance-planning outputs are1466 and1688 pairs, both above the fixed cap32; under this load-affected repetition declaration those numbers are retained diagnostics and authorize no confirmation campaign.

The20-prelude/32-subsequent partition for every started VM is retained below. These are sums of phase elapsed intervals, not full H: startup, calibration, between-phase gaps and final tail remain included in H separately. The failed01/2/ON row contains only31 completed subsequent batches and has no terminal H or final tail.

| Set / pair / mode | Prelude phase sum (s) | Subsequent completed phase sum (s) | Subsequent batches |
| --- | ---: | ---: | ---: |
| 01 / 1 / OFF | 139.594 | 172.504 | 32 |
| 01 / 1 / ON | 86.542 | 330.123 | 32 |
| 01 / 2 / ON | 135.692 | 357.243 | 31 |
| 02 / 1 / OFF | 137.791 | 183.437 | 32 |
| 02 / 1 / ON | 137.273 | 383.369 | 32 |
| 02 / 2 / ON | 133.191 | 342.346 | 32 |
| 02 / 2 / OFF | 150.372 | 186.413 | 32 |
| 02 / 3 / OFF | 135.645 | 161.050 | 32 |
| 02 / 3 / ON | 136.217 | 323.559 | 32 |
| 02 / 4 / ON | 87.338 | 295.356 | 32 |
| 02 / 4 / OFF | 69.199 | 103.504 | 32 |
| 03 / 1 / OFF | 76.608 | 138.978 | 32 |
| 03 / 1 / ON | 196.384 | 244.054 | 32 |
| 03 / 2 / ON | 77.264 | 248.784 | 32 |
| 03 / 2 / OFF | 84.265 | 122.244 | 32 |
| 03 / 3 / OFF | 80.056 | 108.744 | 32 |
| 03 / 3 / ON | 81.577 | 183.002 | 32 |
| 03 / 4 / ON | 84.485 | 360.485 | 32 |
| 03 / 4 / OFF | 182.548 | 143.379 | 32 |

Set01 timed out in pair02/ON after20 prelude and31 subsequent batches. The last completed batch was SHA-256 sample7; JSON sample7 had started but produced no result. Gates147/148 and t1 are missing. The failed prefix is preserved, not extrapolated. The unstarted steps are `pair-02-off`, `pair-03-off`, `pair-03-on`, `pair-04-on`, and `pair-04-off`. The [permanent halt](../../artifacts/passive-fifo-finite-exploration-01/invalid-completed-observation.json) prohibits replacement; the [incomplete-record audit](../../artifacts/passive-fifo-finite-incomplete-review-01/review.json) does not accept a complete set.

Host condition evidence remains descriptive. All19 started captures retained successful before/after checks that the12GiB compiler VM was stopped; those checks do not continuously monitor unrelated host activity. One-minute host-load samples are shown with the capture request/exit windows, not as corrections, exclusion rules or causal explanations. Exact timestamps, all before/after load/free-memory/compressor/swap observations when recorded, phase pool/linear-memory snapshots and per-workload prelude/subsequent totals are in the [durable summary JSON](../../artifacts/passive-fifo-load-affected-repetitions-01/summary.json). Both later sets have descriptive drift outside the nominal band; it was not an exclusion or retry criterion.

| Set | UTC capture request–last exit,2026-11-07 | Sampled1-minute load range |
| --- | --- | ---: |
| 01 | 14:27:25.080–14:52:08.927 | 16.786–25.180 |
| 02 | 15:19:01.451–16:17:39.880 | 10.914–51.796 |
| 03 | 16:31:27.303–17:20:38.381 | 11.665–23.255 |

The complete sets retain phase-observed linear-memory ratios of1 for every pair. This is neither host peak memory nor native JIT resident memory. Earlier [held-out correctness](../../artifacts/passive-fifo-heldout-review-01/review.json), [diagnostic lifetime/continuation](../../artifacts/passive-fifo-combined-review-01/review.json) and [generated-module-input-byte](../../artifacts/passive-fifo-resource-review-01/review.json) reviews retain their original scopes; they do not convert these timings into causal performance or complete memory acceptance.

| Set | Raw campaign / plan | Analysis | Independent review |
| --- | --- | --- | --- |
| 01 | [raw campaign](../../artifacts/passive-fifo-finite-exploration-01) / [frozen plan](../../artifacts/passive-fifo-finite-exploration-01/plan.json) | No complete-set analysis | [incomplete audit](../../artifacts/passive-fifo-finite-incomplete-review-01/review.json) |
| 02 | [raw campaign](../../artifacts/passive-fifo-deadline-v2-exploration-02) / [frozen plan](../../artifacts/passive-fifo-deadline-v2-exploration-02/plan.json) | [analysis JSON](../../artifacts/passive-fifo-deadline-v2-analysis-02/analysis.json) | [passed replay](../../artifacts/passive-fifo-deadline-v2-review-02/review.json) |
| 03 | [raw campaign](../../artifacts/passive-fifo-deadline-v2-exploration-03) / [frozen plan](../../artifacts/passive-fifo-deadline-v2-exploration-03/plan.json) | [analysis JSON](../../artifacts/passive-fifo-deadline-v2-analysis-03/analysis.json) | [passed replay](../../artifacts/passive-fifo-deadline-v2-review-03/review.json) |

The summary JSON preserves every raw report/request/exit identity and capture nonce, exact full-H partitions, all completed phase rows, paired ratios, nine endpoint estimates, per-workload partitions, host snapshots and source evidence hashes. Its arithmetic was checked against retained raw report JSON and existing passed independent reviews; large snapshots were not rehashed and no analyzer, guest, test or build was rerun to create this report. Selection remains false for both completed sets. No further repetition or promotion is authorized by this report.
