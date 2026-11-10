# M2 MSG2 timing

This uses the unchanged M1 Bun bundle, ACK protocol, ten warmup cycles and three
100-call batches for each original workload. The new host adapter configures
the MSG2 lowering once before guest startup. Profiling/code inspection and
diagnostic runtime exports are rejected. Original M1 sources remain unchanged;
the copied adapter/campaign provenance is recorded in `adapter-provenance.json`.

Both modes use the same runtime bytes. Their `experiment.enabled` value is
included in the manifest compatibility hash, so snapshots cannot cross modes.
The existing original bundle and initramfs can be repackaged without rebuilding
Bun (all copied bytes are rehashed):

```sh
node benchmarks/harness/m2/package.mjs --base artifacts/m1-baseline-01/app.mjs.app \
  --runtime artifacts/m2-msg2-build-01/runtime/x86_64 --enabled 0 --output artifacts/m2-package-off-01
node benchmarks/harness/m2/package.mjs --base artifacts/m1-baseline-01/app.mjs.app \
  --runtime artifacts/m2-msg2-build-01/runtime/x86_64 --enabled 1 --output artifacts/m2-package-on-01
node benchmarks/harness/m2/plan.mjs --kind screen \
  --control artifacts/m2-package-off-01 --candidate artifacts/m2-package-on-01 \
  --input artifacts/m2-msg2-build-01/build-report.json --output artifacts/m2-screen-plan-01.json
node benchmarks/harness/m2/campaign.mjs --plan artifacts/m2-screen-plan-01.json --output artifacts/m2-screen-01
node benchmarks/harness/m2/analyze.mjs --campaign artifacts/m2-screen-01 --output artifacts/m2-screen-analysis-01
```

The initial screen is one independent capture pair and makes no inference.
It selects only if the SHA time ratio is below 0.95 and every other workload's
point ratio is below 1.10. A selected screen can create a fresh eight-pair
confirmation plan:

```sh
node benchmarks/harness/m2/plan.mjs --kind confirmation \
  --control artifacts/m2-package-off-01 --candidate artifacts/m2-package-on-01 \
  --selection artifacts/m2-screen-analysis-01/analysis.json \
  --input artifacts/m2-msg2-build-01/build-report.json --output artifacts/m2-confirm-plan-01.json
node benchmarks/harness/m2/campaign.mjs --plan artifacts/m2-confirm-plan-01.json --output artifacts/m2-confirm-01
node benchmarks/harness/m2/analyze.mjs --campaign artifacts/m2-confirm-01 --output artifacts/m2-confirm-analysis-01
```

Each VM contributes one median per endpoint; the bootstrap resamples whole
paired log-ratios. It never treats nested batches as independent. Off/on order
alternates between pairs. Fresh nonces must differ from the screen, and all
completed slow observations remain. The primary 99% interval's upper bound must
be below 0.95. Secondary regression limits use Bonferroni one-sided bounds for
the three other workloads, and readiness/observed memory have declared budgets.
Readiness includes capture/durable publication; it is not pure guest boot.
The eight-pair count is practical and predeclared, not a power guarantee.

Service checks compare each VM's empty-gate 95th percentile and maximum
result-to-confirmed-stop tail, each with a 1.50 ratio budget and Bonferroni
one-sided bounds. These are control-protocol proxies, not general worst-case
interrupt or networking latency. Runtime artifact bytes must be identical.
Generated/resident code bytes are not exposed by this timing runtime: its
declared 1.10 ratio budget stays unverified, and every report explicitly keeps
`productPromotionEligible: false` until the remaining evidence exists.

Exact guest semantics, demonstrated compiled exposure, held-out workload and
resource/service requirements remain separate promotion gates. Passing the
statistical gate alone does not establish a release. Linear memory and charged
instance counts are sampled at stopped phase boundaries and do not measure
every transient host allocation.

The campaign retains the tested durable attempt/lock/resume behavior of the M1
orchestrator and shares its project-wide lock. It freezes all sources, packages,
plan and extra inputs before starting. Repeat the exact command to resume.
Run builds, fixtures and campaigns serially. Never edit frozen inputs while
resuming a campaign; use a fresh campaign if an implementation changes.

```sh
node --test benchmarks/harness/m2/*.test.mjs
```
