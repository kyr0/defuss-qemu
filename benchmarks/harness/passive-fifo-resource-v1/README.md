# Passive FIFO full-horizon resource observation

A separate diagnostic wrapper measures cumulative generated module input bytes for the new passive policy. It uses the exact performance WASM, adds the unchanged previously reviewed five-anchor JavaScript observer, and records all20 prelude and32 subsequent batches plus VM-start/complete totals. No M1/M2/sustained/resource-v2 or finite-v1 source changes. The observer's three source files (`derive.mjs`, `observer.js`, `observer.mjs`) remain byte-identical to resource-v2.

The resource plan is independent of any timing plan. It prospectively binds both finite production packages, reviewed performance build/source audit, exact workload/VM settings, host condition, source inputs and the1.10 cumulative-byte budget. This permits resource evidence before timing; a later timing plan can include its report and independent review without a circular dependency. Plans must include this source freeze/review and actual relevant correctness/exposure evidence through repeated`--input`. The compiler VM is required Stopped before and after each capture; all owned heavy work is serialized by the operator.

The observer counts successful module instantiation bytes anew on every instantiation; duplicates/reinstantiations are charged again. It separately preserves attempted/compiled/instantiated counts, import-vector bytes and cumulative maxima. Exact cumulative partitions, monotonic deltas, raw serial/maps,149 signals,148 gate chronology, same original performance WASM, five exact JS derivation anchors, complete production/derived specifications, plan/input identities and inner/outer snapshot hashes are revalidated. Final locked/effective FIFO state must match the requested mode. Both reports must be fresh captures with distinct nonces.

The budget is candidate/control cumulative successfully instantiated module input bytes from VM start to the stopped complete gate, at most1.10. All four workload totals combine13 phases each; prelude and subsequent rows remain separate as well. This is one descriptive resource pair. It does not measure native JIT resident bytes, currently live functions, true host peak memory or long-run stability. Diagnostic timing is explicitly ineligible and the timing loader rejects this identity. No performance or product promotion claim follows from a passing byte budget.

After the exact performance build/post-build review and source validation, create finite production packages through`tests/passive-fifo-heldout/package.mjs --workload finite` (see that README), then:

```sh
node benchmarks/harness/passive-fifo-resource-v1/package.mjs --production artifacts/passive-fifo-package-off-01 --output artifacts/passive-fifo-resource-package-off-01
node benchmarks/harness/passive-fifo-resource-v1/package.mjs --production artifacts/passive-fifo-package-on-01 --output artifacts/passive-fifo-resource-package-on-01
node benchmarks/harness/passive-fifo-resource-v1/plan.mjs --control artifacts/passive-fifo-package-off-01 --candidate artifacts/passive-fifo-package-on-01 --input ACTUAL_SOURCE_FREEZE_AND_REVIEW --output benchmarks/plans/passive-fifo-resource-01.json
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node benchmarks/harness/passive-fifo-resource-v1/run.mjs --plan benchmarks/plans/passive-fifo-resource-01.json --package artifacts/passive-fifo-resource-package-off-01 --output artifacts/passive-fifo-resource-off-01
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node benchmarks/harness/passive-fifo-resource-v1/run.mjs --plan benchmarks/plans/passive-fifo-resource-01.json --package artifacts/passive-fifo-resource-package-on-01 --output artifacts/passive-fifo-resource-on-01
node benchmarks/harness/passive-fifo-resource-v1/analyze.mjs --control artifacts/passive-fifo-resource-off-01/report.json --candidate artifacts/passive-fifo-resource-on-01/report.json --output artifacts/passive-fifo-resource-analysis-01
```

`ACTUAL_*` is a placeholder: use existing reviewed evidence paths when freezing the real plan. No resource pair has been run in this source-only validation. Test command:

```sh
node --test tests/passive-fifo-heldout/*.test.mjs benchmarks/harness/passive-fifo-resource-v1/*.test.mjs
```
