# M3b source and runtime provenance

The nine synthetic host tests for `provenance.py` passed in
`artifacts/m3b-safe-gap-host-tests-03/provenance.log`, with the successful command
and unchanged input identities retained in that directory's `report.json`.
Actual source freeze, full post-build recheck and runtime binding remain pending.
Only root runs these operations in a safe interval. They do not start an SDK, browser or
guest. The `bind` subcommand runs Node only to execute the already reviewed
fixture identity verifier. No previous source, report or runtime is overwritten.
Fresh output directories retain a durable `started.json`; failures retain
`failure.json` and any partial files. Final JSON records use exclusive creation
and fsync. Source archives are published before their final manifest. Binding
staging stays under project `tmp` and is retained.

The final freeze covers every authored file under this experiment, the existing
45-gate fixture, new boundary fixture and profile-control fixture. It follows
literal ES-module imports and records explicit Python build/packaging, injected
runtime JS, runtime-support, package-lock, kernel/ROM and base-image dependencies.
This is a bounded closure for the reviewed source layout, not a general Python
or JavaScript dependency resolver. Unknown packages, symlinks, unexpected source
suffixes, changed live/archive bytes and additions to authored directories fail.
An independent reviewer must check the actual final closure before publishing
`status: "passed"`, the exact `sourceManifest` identity and `sourceBlockers: []`.
The tool never writes that independent review.

The graph review must already bind the pinned header and graph/object strings.
It additionally supplies nonempty `inventory: [{path,sha256,bytes}]` and complete
`observation`, `observerSourceManifest`, `observerSourceReview` references, all
present in that inventory. The observation must be actual v3, observed, OFF and
without input drift. Inventory includes its `report.json`, `qmp.log`, `qtree.txt`,
`serial.log`, `events.jsonl`, and `preflight.json`. The freezer also verifies and
retains every live/archive entry from the observer source manifest. Graph review
does not substitute for the new native profile's runtime eligibility checks.
External Chrome and Lima executable identities remain in the hashed observation
and host-condition evidence; they are not copied into project source dependencies.
Historical artifact JS is hash-bound as evidence rather than scanned as a current
source module. Fresh compiled runtime closure is checked separately as seven files.

The first command below has passed. The source-freeze command remains
prospective and requires the actual graph pin/review and source quiet:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-fallthrough/test-provenance.py

python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-fallthrough/provenance.py freeze \
  --output artifacts/m3b-implementation-source-01 \
  --graph-review artifacts/m3b-graph-review-01/review.json \
  --test-evidence artifacts/m3b-safe-gap-host-tests-03/report.json \
  --test-evidence artifacts/m3b-safe-gap-host-tests-03/overlay.log \
  --test-evidence artifacts/m3b-safe-gap-host-tests-03/fixtures.log \
  --test-evidence artifacts/m3b-safe-gap-host-tests-03/anchors.log \
  --test-evidence artifacts/m3b-safe-gap-host-tests-03/provenance.log \
  --test-evidence artifacts/m3b-predecode-tests-02/report.json
```

The test evidence paths above exist; source/build/binding output paths remain
reserved for their future operations. A failed attempt keeps its directory and requires
a fresh numbered output. Add actual syntax/test evidence with repeated
`--test-evidence` and other reviewed supporting files with `--dependency`.
Test evidence is retained without the freezer inventing test pass claims.
Root's gap runner emits the aggregate `fixtures.log` for fixture, profile and
boundary host tests. The unchanged predecoder retains its actual revision02
test report; no new predecoder run is implied by the final freeze command.
After the independent final source review, root runs `prepare.py` and the actual
SDK build. Root selected `--jobs 4`; the recheck must use that exact value:

```sh
python3 scripts/sdk.py python3 scripts/build.py \
  --source artifacts/m3b-source-01/source --output artifacts/m3b-build-01 \
  --targets x86_64-softmmu --jobs 4

python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-fallthrough/provenance.py recheck \
  --source artifacts/m3b-source-01/source --build artifacts/m3b-build-01 \
  --manifest artifacts/m3b-implementation-source-01/manifest.json \
  --review artifacts/m3b-implementation-source-review-01/review.json \
  --sdk-invocation tmp/sdk-ACTUAL-INVOCATION/invocation.json --jobs 4 \
  --output artifacts/m3b-build-review-01
```

`tmp/sdk-ACTUAL-INVOCATION/invocation.json` is intentionally a placeholder: root
must supply the retained successful wrapper record for that actual build. The
tool validates its offline pinned-image argv, project scratch and ordered
timestamps. It rejects mismatched build commands or jobs. No successful SDK
invocation is inferred from output-file presence.

The recheck imports only the already frozen/reviewed `prepare.py` as the patch
specification, regenerates expected changes in memory, hashes the complete
base/prepared trees, checks every unmodified byte identity and exactly seven
runtime files, and compares the actual pre-build fingerprint. It writes
`artifacts/m3b-build-01/source-recheck.json` exclusively, plus full inventory and
copied SDK completion evidence under its review output. This is a build identity
proof, not guest execution acceptance.

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-fallthrough/provenance.py bind \
  --build artifacts/m3b-build-01 \
  --manifest artifacts/m3b-implementation-source-01/manifest.json \
  --review artifacts/m3b-implementation-source-review-01/review.json \
  --graph-review artifacts/m3b-graph-review-01/review.json \
  --output artifacts/m3b-diagnostic-binding-01
```

The resulting runtime binding is
`artifacts/m3b-diagnostic-binding-01/binding.json` (a directory plus file, replacing
the earlier prospective standalone filename). The unchanged
`tests/m3b-fallthrough/runtime-identity.mjs` must accept the staged record before
it is published. All real fixture runner commands use that final path via
`--binding`; their build, graph, source and actual execution gates still apply.
