# Independent sustained resource evidence review

`review.py` replays a retained control/candidate resource-v2 pair and its published
analysis using Python standard-library code. It never executes the JavaScript
analyzer, runtime, guest or browser. Raw guest gate/lifecycle/manifest/plan helpers
come from the separately reviewed, SHA-pinned independent sustained Python
reviewer. A changed dependency fails before review.

The reviewer independently reconstructs all five runtime-JavaScript derivation
anchors, verifies unchanged production WASM and complete non-observation VM/package
specifications, and checks the exact frozen timing plan and before/after stopped
compiler-VM observations. It hashes all required source, served payload, package,
raw serial/maps and retained snapshot files. Snapshot gzip metadata and decompressed
payload identity are checked in bounded chunks. It checks all149 COM1 signals and
148 stopped gates,20 warmup batches and32 measured batches.

Counter checks use exact Python integers, reject values outside the JavaScript
safe-integer report contract, require complete attempt/compile/instantiate counts,
and reconstruct initial+gap+warmup+measured+tail partitions. Maxima are cumulative
bounds, never subtracted. The published total and endpoint sums and descriptive
candidate/control byte ratio≤1.10 are recomputed independently. Final input rehash
failure always leaves a failed review.

```sh
python3 scripts/with-tmp.py python3 -B experiments/m2-resource-review/test-review.py
python3 scripts/with-tmp.py python3 -B experiments/m2-resource-review/review.py \
  --control artifacts/m2-resource-v2-off-01/report.json \
  --candidate artifacts/m2-resource-v2-on-01/report.json \
  --analysis artifacts/m2-resource-v2-analysis-01/analysis.json \
  --output artifacts/m2-resource-v2-review-01
```

Outputs are immutable fresh artifact directories. Synthetic test data is retained
under project `tmp`; tests do not start a guest, compiler VM or browser. A passed
evidence review means the retained records and arithmetic agree, even when the
byte budget fails. Diagnostic timing remains ineligible. Cumulative module input
bytes include repeated instantiation and are neither native JIT resident bytes,
live-code bytes, true host peak memory nor a long-run bound. This review cannot
establish performance improvement or product promotion.
