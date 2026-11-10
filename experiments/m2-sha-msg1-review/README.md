# Independent MSG1 diagnostic ISA replay

This standalone Python reviewer reads the retained reports, requests, raw serial,
frozen source manifests, diagnostic overlay, runtime build, guest build and exact
artifact bytes. It does not import the JavaScript validator or run a guest.
All counter arithmetic uses Python integers and canonical uint64 decimal strings.

Run the small corruption tests with:

```sh
python3 -B experiments/m2-sha-msg1-review/test-isa.py
```

Replay the complete matrix into a fresh, immutable output directory:

```sh
python3 -B experiments/m2-sha-msg1-review/review-isa.py \
  --report artifacts/m2-msg1-diagnostic-hot-on-01/report.json \
  --report artifacts/m2-msg1-diagnostic-hot-off-01/report.json \
  --report artifacts/m2-msg1-diagnostic-cold-on-01/report.json \
  --report artifacts/m2-msg1-diagnostic-cold-off-01/report.json \
  --require-matrix --output artifacts/m2-msg1-diagnostic-review-01
```

Every interval must contain exactly 4,096 successful MSG1 instructions, except
the last interval's 8,192 (ordinary checks plus 4,096 fault-PC warmups). Original
helper counts include the compiled-fallback subset; inline counts are disjoint.
The reviewer independently reconstructs interpreted, compiled-inline and
compiled-fallback totals, rejects forbidden cumulative banks even before the
first interval, and verifies all eight gates and exact serial marker order.

The prepared source inventory is bound to the prior independent full-source
post-build audit. This reviewer rehashes all runtime files, changed overlay files,
frozen implementation/fixture files, their archives, and every run input; it does
not repeat the 10,101-file source walk. It rehashes all retained inputs at the end.
Outputs use exclusive creation and fsync; test scratch stays under project `tmp`.

QMP stop/query actions and the requested machine arguments are bound through the
frozen runner and recorded gate state; no raw QMP transcript exists to replay.
Aggregate counters cannot attribute the individual fault to a particular tier.
These Node direct Emscripten flags2 fixture runs prove tested ISA behavior and
selected-path execution. They do not prove Chrome Bun flags3 exposure or speed.
