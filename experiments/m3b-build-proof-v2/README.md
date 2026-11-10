# Isolated M3b build-proof correction

The actual QEMU build01 completed successfully. The frozen first recheck tool
rejected the first of14 legitimate retained QEMU symlinks before publishing a
source recheck. Its failure remains under `artifacts/m3b-build-review-01`.
No frozen implementation file, prepared engine file, built runtime or original
proof-tool source is changed by this correction.

`proof.py` is derived from the exact archived implementation-source01
`provenance.py` (SHA256
`2053833d048cc25a3743288c0638f5c47ed63bef78e397c88c2fee953d320d1f`).
It retains the reviewed overlay/build/SDK/runtime checks and original strict
generic evidence reader. Only full engine-tree inventory uses the new reader.
The v2 proof and binding explicitly carry the actual v2 tool path, source
manifest, independent source review and engine-reader identity. They do not
claim that the frozen original tool successfully ran.

The allowlist names exactly11 file aliases and3 directory links, with exact
relative link text, canonical target and target kind. Both the frozen baseline
and copied prepared tree must match it. Unknown, missing, externally resolved,
absolute, chained or differently spelled links fail. File aliases contribute
their original logical relative filename plus target file-byte hash, exactly
as `prepare.py` and `scripts/build.py` do. Directory links are not traversed and
add no duplicate aliases. Their complete canonical target file closure is
nevertheless present in the whole-tree fingerprint and separately recorded.
Lstat identity, link text, target closure and names are checked again before
publication; regular target mutation is covered by the existing stable audit.
Runtime, authored source and ordinary dependency paths continue rejecting all
symlinks. The corrected tool never adds an exception to generic `inside()`.

A second exact-fingerprint discrepancy was identified before execution: the
frozen proof sorted logical filename strings, while prepare/build sort `Path`
objects by components. For example, `headers/one.h` precedes `headers.h` in the
actual build. V2 uses the same `Path` ordering; a focused fixture includes this
collision and checks both v2 fingerprints against the original build loop.
The baseline metadata has2101 positions where raw string ordering differs.

As authored, the focused synthetic tests are unexecuted. Root owns serial
execution and must authorize the next safe gap. Test scratch stays under the
project `tmp`; no test creates a real engine build or guest. Keep every failed
attempt and choose fresh output directories for retries.

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-build-proof-v2/test-proof.py
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-build-proof-v2/proof.py freeze-tool --output artifacts/m3b-build-proof-v2-source-01 --test-evidence artifacts/m3b-build-proof-v2-tests-01/report.json --test-evidence artifacts/m3b-build-proof-v2-tests-01/tests.log
```

An independent reviewer must verify the actual new source freeze and test
evidence, publishing `artifacts/m3b-build-proof-v2-source-review-01/review.json`
with `status:passed`, its exact `sourceManifest` reference and no
`sourceBlockers`. Only then may root run the real corrected recheck:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-build-proof-v2/proof.py recheck --source artifacts/m3b-source-01/source --build artifacts/m3b-build-01 --manifest artifacts/m3b-implementation-source-01/manifest.json --review artifacts/m3b-implementation-source-review-01/review.json --tool-manifest artifacts/m3b-build-proof-v2-source-01/manifest.json --tool-review artifacts/m3b-build-proof-v2-source-review-01/review.json --sdk-invocation tmp/sdk-5sbqydxg/invocation.json --jobs 4 --output artifacts/m3b-build-review-02
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-build-proof-v2/proof.py bind --build artifacts/m3b-build-01 --manifest artifacts/m3b-implementation-source-01/manifest.json --review artifacts/m3b-implementation-source-review-01/review.json --tool-manifest artifacts/m3b-build-proof-v2-source-01/manifest.json --tool-review artifacts/m3b-build-proof-v2-source-review-01/review.json --graph-review artifacts/m3b-graph-review-01/review.json --output artifacts/m3b-diagnostic-binding-01
```

The recheck must reproduce actual build fingerprint
`b458c012278728289c39b971bb0a7d01fc2a15411eebb4124399d3d72d2551b1`,
all deterministic overlay bytes, all seven runtime files and the completed
offline SDK invocation with jobs4. `build/source-recheck.json` is published
exclusively only on success. Bind verifies the v2 proof closure, then invokes
the unchanged frozen `tests/m3b-fallthrough/runtime-identity.mjs` consumer on a
staged binding under project `tmp` before publishing it. That consumer retains
its original engine/runtime/graph acceptance scope; the v2 tool provenance is
validated by this reviewed binding producer and recorded as additional fields.
No guest, native-profile eligibility, timing or promotion claim follows from
either proof operation.
