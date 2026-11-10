# M2 sustained-v2

This is a separate protocol from the retained, failed v1 screen. It runs the exact `benchmarks/workload/operations.ts`, input sizes and answers with the same runtime bytes and VM settings. The bundle and snapshot identities change. No old M1/M2 source or evidence is edited.

Each fresh VM records five warmup rounds of 100 calls per endpoint (500 each), followed by eight measured 100-call batches per endpoint (800 each). Four balanced orders cover every endpoint position and every directed within-round predecessor pair once; the measured sequence repeats them twice. All 20 warmup and 32 measured rows retain host/guest times and stopped pool snapshots. There are 148 validated gates. Warmup does not establish JIT/admission convergence.

Exploration is exactly four fresh independent pairs in AB/BA/AB/BA order. Each VM contributes the median of all eight measured batches for each endpoint. No conditional warmup, batch deletion, extra pairs or retry-to-select is allowed. An early-four/late-four median ratio outside `[1/1.10,1.10]` for any endpoint/VM vetoes selection for the whole campaign; it never marks that VM as a replaceable execution failure. All data remain. Passing this suitability check is not a stationarity proof.

The SHA primary and integer/JSON/HTTP regression margins stay 0.95/1.10, with the original 99% primary interval and Bonferroni one-sided secondary bounds. Readiness 1.10, observed linear memory 1.10, runtime artifact 1.00, generated code 1.10 and service 1.50 budgets remain. Service values are protocol proxies, not general interrupt/network worst cases. Generated/resident code remains a separate diagnostic gate. Reports never promote a product automatically.

Before confirmation, `planning.mjs` uses all four pilot paired log-ratios for each endpoint. Its design SD is the upper 90% Gaussian SD bound (`s*sqrt(3/chi2(0.10,3))`). Fixed target ratios are 0.90 primary and 1.00 elsewhere; approximate power is 80%, with the existing endpoint confidence bounds. The largest calculated N is rounded up to even, minimum 8, maximum 32. The formula and constants are frozen before exploration. A calculated N above 32 blocks confirmation; it is never clamped. This small-pilot calculation is conservative approximate planning, not proof of power for the eventual bootstrap decision. Confirmation uses exactly that calculated N in entirely fresh captures, with no pilot observations pooled.

The compiler VM must be stopped before and after every fresh run. The frozen plan pins the SHA of `limactl`, its `LIMA_HOME`, exact `list builder --json` arguments, name `builder`, status `Stopped` and 12 GiB allocation. Raw stdout/stderr plus `vm_stat`, swap usage and ordinary host load/free memory are retained. Sandbox status `Broken` fails closed; run the real campaign with the same already-authorized access needed for Chrome/localhost. Do not run packaging, builds, diagnostics or other owned heavy work concurrently.

A pre-execution host-condition rejection retains the failed attempt and may resume after the condition is fixed. Once the guest observation completes, any later host-condition/evidence failure permanently invalidates that campaign; `invalid-completed-observation.json` prevents replacing the capture on resume. Checks before/after cannot detect an unobserved transient VM start during the interval, so the no-owned-heavy-work rule remains required.

Every run creates a flat short `defuss-vm/tmp/s-XXXXXX` directory and sets `TMPDIR`, `TMP` and `TEMP` before Chrome or child processes start. Its `run.json` metadata remains; durable results remain under `artifacts`. Chrome157 was actually launched with this absolute path shape, with profile/download scratch observed there and no socket-length failure; see `artifacts/m2-sustained-tmp-validation-02.json` and its launch log. Host test scratch is likewise retained under project `tmp`.

Prepare the bundle/package while the compiler VM is available, then stop that VM before measurement. Run these serially, choosing fresh artifact paths:

```sh
python3 packaging/bundle-bun.py benchmarks/harness/m2-sustained-v2/driver.ts --project-root . --outfile artifacts/m2-sustained-v2-bundle-01/app.mjs --snapshot-ready manual --runtime-dir artifacts/m2-msg2-build-01/runtime/x86_64
node benchmarks/harness/m2-sustained-v2/package.mjs --base artifacts/m2-sustained-v2-bundle-01/app.mjs.app --enabled 0 --output artifacts/m2-sustained-v2-package-off-01
node benchmarks/harness/m2-sustained-v2/package.mjs --base artifacts/m2-sustained-v2-bundle-01/app.mjs.app --enabled 1 --output artifacts/m2-sustained-v2-package-on-01
node benchmarks/harness/m2-sustained-v2/plan.mjs --kind exploration --control artifacts/m2-sustained-v2-package-off-01 --candidate artifacts/m2-sustained-v2-package-on-01 --input artifacts/m2-screen-warmup-review-01.json --input artifacts/m2-msg2-build-01/build-report.json --input artifacts/m2-sustained-v2-bundle-01/app.mjs.build.json --output artifacts/m2-sustained-v2-exploration-plan-01.json
node benchmarks/harness/m2-sustained-v2/campaign.mjs --plan artifacts/m2-sustained-v2-exploration-plan-01.json --output artifacts/m2-sustained-v2-exploration-01
node benchmarks/harness/m2-sustained-v2/analyze.mjs --campaign artifacts/m2-sustained-v2-exploration-01 --output artifacts/m2-sustained-v2-exploration-analysis-01
```

Also bind the lowering/configuration/source manifest and correctness/held-out evidence through repeated `--input` arguments, as in v1. Include an independent review of the pilot before confirmation. If exploration selects the candidate, passes the drift suitability check and yields a feasible N, use the same plan command with `--kind confirmation --selection artifacts/m2-sustained-v2-exploration-analysis-01/analysis.json` and new output paths. Plan generation recomputes the variance calculation and refuses a different result.

Host verification: `node --test benchmarks/harness/m2-sustained-v2/*.test.mjs`. It includes synthetic full report replay, warmup/measured phase confusion rejection, protocol corruption, source preservation, host-condition rejection and durable eight-step resume without adding observations. Real guest evidence remains required.
