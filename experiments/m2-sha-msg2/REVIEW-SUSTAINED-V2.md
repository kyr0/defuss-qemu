# Independent sustained-v2 review

The original `review-confirmation.py` remains unchanged with the failed v1
screen. `review-sustained-v2.py` independently reviews the separate sustained
protocol without importing or executing the JavaScript analyzer.

```sh
python3 experiments/m2-sha-msg2/review-sustained-v2.py \
  --campaign artifacts/m2-sustained-exploration-new \
  --analysis artifacts/m2-sustained-exploration-analysis-new/analysis.json \
  --output artifacts/m2-sustained-exploration-review-new
python3 experiments/m2-sha-msg2/review-sustained-v2-test.py
```

The same command reviews confirmation and recursively rechecks its independent
exploration and sample-size selection. Output directories must be fresh. A zero
exit means valid evidence agrees with the published analysis; it does not mean
selection, confirmation or product-promotion gates passed.

The reviewer rehashes frozen inputs, Node/Chrome, the compiler-VM status
executable, package payloads, snapshots, maps, requests and accepted reports.
It replays all 148 guest gates and raw serial/COM1 identities, all 20 warmup
batches and 32 measured batches, fixed Williams orders, nonce separation,
stopped host-condition records and exact alternating capture pairs. Completed
observations omitted after host/evidence failures and permanent campaign halt
records are rejected.

All eight measured batches contribute to each VM median. The reviewer computes
the early-four/late-four drift suitability check, whole-pair log bootstrap,
unchanged performance/resource/service thresholds and the whole-campaign drift
veto. It never excludes an individual slow batch or replaces a drifting VM.

Confirmation planning independently inverts the closed-form chi-square CDF
for three degrees of freedom and obtains normal quantiles from Python's
standard library. It checks the declared 90% upper pilot-SD design, 80% target
power, fixed 0.90 primary/1.00 other target ratios, next-even rounding and minimum
eight pairs. Required counts above 32 remain infeasible, not clamped. This
Gaussian planning approximation is not a power guarantee for the later
bootstrap decision, especially with only four exploratory pairs.

Tests cover raw-protocol corruption, fixed cross-language bootstrap values,
sample-size quantiles and infeasible caps, drift vetoes, four fresh exploration
pairs and a separate 14-pair synthetic confirmation with recursive replay.
Generated test evidence is retained under `defuss-vm/tmp/` for inspection.
No test launches a browser, guest, compiler VM or external service.
