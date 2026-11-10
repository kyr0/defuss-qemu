# Separate generated-module byte accounting

This diagnostic wrapper derives only JavaScript from each production MSG2 package. The WebAssembly, guest bundle, kernel, initramfs and ROM bytes remain identical. Five exact single-occurrence anchors add an atomic observer around `instantiate_wasm` and propagate its shared counter bus to workers. `derivation.json` records the original/derived JavaScript, observer hash, anchor hashes, original package identity and unchanged WASM hash. The analyzer replays derivation and verifies both packages.

Analysis requires the full off/on package specifications to match except their bound lowering choice and compatibility identity. Both must retain the fixed timing VM configuration. Each derived package must preserve every production specification except its JavaScript artifact and added observation identity. Required source/package hashes cannot be omitted, and the retained snapshot SHA and size are rechecked.

All collected timings are diagnostic. Reports use `defuss-m2-resource-v1`, which the existing timing report loader rejects. The guest protocol and workload are unchanged. Fresh captures are mandatory, and the new manifest observation identity prevents reuse of timing snapshots.

Run these serially after the uninstrumented timing campaign:

```sh
node benchmarks/harness/m2-resource/package.mjs --production artifacts/m2-package-off-01 --output artifacts/m2-resource-package-off-01
node benchmarks/harness/m2-resource/package.mjs --production artifacts/m2-package-on-01 --output artifacts/m2-resource-package-on-01
node benchmarks/harness/m2-resource/run.mjs --package artifacts/m2-resource-package-off-01 --output artifacts/m2-resource-off-01
node benchmarks/harness/m2-resource/run.mjs --package artifacts/m2-resource-package-on-01 --output artifacts/m2-resource-on-01
node benchmarks/harness/m2-resource/analyze.mjs --control artifacts/m2-resource-off-01/report.json --candidate artifacts/m2-resource-on-01/report.json --output artifacts/m2-resource-analysis-01
```

Counters are uint64 atomics. Attempts, successful module compilations, successful instantiations, cumulative module input bytes, cumulative QEMU import-vector bytes and maximum single-module input bytes are observed. JSON conversion rejects overflow or inexact integers. Phase boundaries and the initialized/complete gates read counters while stopped. Successful reports require attempts, compilations and instantiations to agree. The complete-gate cumulative successfully instantiated byte ratio has a predeclared 1.10 budget; phase deltas are descriptive context. A single resource pair is not a confidence interval or a product promotion.

Repeated instantiation counts bytes again. This measures cumulative generated module input, not deduplicated modules, live function bytes, native JIT code, or host resident memory. Import-vector bytes represent uint64 helper-slot storage, not the module's encoded import section. They are reported separately. No garbage-collection instrumentation is used, so finalization timing cannot be mistaken for live bytes. Cumulative maxima cannot be subtracted to obtain phase maxima.

Small host tests: `node --test benchmarks/harness/m2-resource/observer.test.mjs`. Real diagnostic guest results remain required.
