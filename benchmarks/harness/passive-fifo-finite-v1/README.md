# Passive FIFO finite-horizon v1

This is a separate prospective experiment for the passive FIFO policy. It does not reuse or relabel any MSG2 measurements. The reviewed design is `docs/decisions/passive-fifo-finite-horizon-design-01.md`. No source in the frozen M1, M2, sustained-v2 or resource-v2 harness is changed.

The guest bundle and operations remain identical to sustained-v2: 20 nominal warmup/prelude batches and 32 subsequent batches, each100 calls, 1300 calls per workload and5200 per VM. The unchanged guest protocol still says `defuss-m2-sustained-v2`; the host report and package measurement identity say `defuss-passive-fifo-finite-v1`. Only the passive policy choice differs between paired packages, with separate snapshot compatibility identities. Both arms use one identical performance runtime, baseline MSG2/M3 emitters, fixed flags3/hot1500,512MiB guest,128MiB TB buffer and12000 charged-instance cap.

`H` begins immediately before `startBunApp`, before assets and runtime initialization. It ends at the complete gate's stopped `readCompleteHostMs`, after protocol and effective-policy readback validation and before the final ACK. Binary64 browser monotonic milliseconds are retained without rounding. The analyzer verifies `H = prefix + all52 phase intervals + all51 intervening gaps + suffix` within an absolute1e-6ms numerical tolerance. Startup, durable snapshot capture, calibration, stopped reads and ACK gaps remain charged to H. Phase sums and all four workload totals include every prelude and subsequent row; separate prelude/subsequent totals are descriptive. Service stop-tail maximum covers all52 phases.

Four new independent pairs run AB/BA/AB/BA. H must improve at least5%; its confirmation bound is the upper endpoint of a two-sided99% paired interval. Five guards (all-phase sum and four workload totals) each use a Bonferroni one-sided99.8% upper bound below1.10. Readiness uses99% below1.10; two service proxies each use99.5% below1.50. The maximum observed stopped-linear-memory ratio per pair must be at most1.10. Whole-pair bootstrap uses50000 draws, seed20261107, xorshift32 and floor-index quantiles as fixed in `horizon.mjs`; every endpoint uses identical pair draws. No nested batch is an independent replicate.

Drift is reported without a plateau claim or exclusion/veto. The fresh pilot supplies paired-log SDs for conservative approximate80% power planning, inflated by the upper90% SD bound for3df. Confirmation uses the maximum required count across all endpoints, rounded even, minimum8 and cap32. Counts above32 are never clamped; no confirmation is permitted under that plan. Confirmation packages and prior selection file are revalidated, and all captures must be wholly fresh.

Before any live pilot, the root operator must include the actual successful performance build report, prepared-source manifest, frozen overlay manifest, independent overlay/source review, exact correctness and separate diagnostic exposure/held-out review in `plan.inputs` via repeated `--input` arguments. Include this harness's frozen source/review records and the unchanged guest build/provenance records too. Review these prerequisites before creating the plan. A runtime directory alone is not accepted evidence of a validated source build. `package.mjs` verifies payload hashes and fixed guest bundle identity; the frozen plan binds the build and review provenance. Missing runtime support or diagnostic/combined exports fail closed before guest work can be accepted.

The compiler VM must be Stopped before and after every capture; the existing host checker binds limactl executable SHA, LIMA_HOME, name and12GiB configuration. The root operator serializes all owned heavy work. The timing process itself does not start/stop the compiler VM. All browser scratch uses the tested short project `tmp/s-*` shape through the unchanged scratch helper; reports and snapshots stay under `artifacts`.

A durable, fsynced execution-start marker is armed before browser entry. From then on, a crash, timeout, failed guest, missing evidence, bad host condition or later validation failure permanently invalidates campaign acceptance. Unknown-start attempts and orphan attempt directories also halt without replacement. Only a hashed failed report with an explicit pre-start certificate and no start marker permits a fresh attempt. Successful completed captures may resume only after all evidence validates. The analyzer rejects omitted unaccepted observations. Lock recovery still requires explicit checking that owned descendants stopped.

The timing analyzer reports only measured gates. Same-runtime JS/WASM bytes are equal by construction. Generated module-input bytes require a separate matching diagnostic run with the1.10 budget; native JIT resident bytes, actual host peak memory and long-run stability remain open. Timing selection or confirmation never enables product promotion. Historical MSG2 resource evidence does not close passive-policy resource gates.

Source-only tests:

```sh
node --test benchmarks/harness/passive-fifo-finite-v1/*.test.mjs
```

Once the new performance runtime and its prerequisites pass, the operator can bind it to the existing guest package; substitute the actual reviewed runtime and evidence paths before freezing a plan:

```sh
node benchmarks/harness/passive-fifo-finite-v1/package.mjs --base artifacts/m2-sustained-v2-bundle-01/app.mjs.app --runtime artifacts/passive-fifo-performance-build-01/runtime/x86_64 --enabled 0 --output artifacts/passive-fifo-package-off-01
node benchmarks/harness/passive-fifo-finite-v1/package.mjs --base artifacts/m2-sustained-v2-bundle-01/app.mjs.app --runtime artifacts/passive-fifo-performance-build-01/runtime/x86_64 --enabled 1 --output artifacts/passive-fifo-package-on-01
node benchmarks/harness/passive-fifo-finite-v1/plan.mjs --control artifacts/passive-fifo-package-off-01 --candidate artifacts/passive-fifo-package-on-01 --kind exploration --input ACTUAL_BUILD_REPORT --input ACTUAL_SOURCE_AND_REVIEW_INPUTS --output benchmarks/plans/passive-fifo-finite-v1-exploration-01.json
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node benchmarks/harness/passive-fifo-finite-v1/campaign.mjs --plan benchmarks/plans/passive-fifo-finite-v1-exploration-01.json --output artifacts/passive-fifo-finite-v1-exploration-01
node benchmarks/harness/passive-fifo-finite-v1/analyze.mjs --campaign artifacts/passive-fifo-finite-v1-exploration-01 --output artifacts/passive-fifo-finite-v1-exploration-analysis-01
```

The illustrative `ACTUAL_*` inputs above are placeholders, not a runnable authorization or a frozen plan. No actual plan or guest measurement is part of the source-only validation.
