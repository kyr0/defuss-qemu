# OFF observer v2: shared-memory transport correction

The first OFF observation failed before any QMP command or graph collection:
Chrome rejected a shared ArrayBufferView passed directly to the raw QMP
TextDecoder. The exact failed report remains at
`artifacts/m3b-device-observation-01/report.json`. All v1 source/archive files
remain unchanged.

This isolated revision copies each Emscripten TTY slice into an owned
Uint8Array before raw decoding and the unchanged QMP parser receive it. The
existing `host/browser/qmp.mjs` already copies its decoder input. The final
serial-file decode also explicitly uses owned bytes and still requires empty
serial output. Tests exercise actual streaming UTF-8, SharedArrayBuffer views,
nonzero offsets, original-heap mutation between consumers, raw-log preservation
on malformed JSON and serial decoding. They do not launch a browser or guest.

The graph module and its four tests are byte-identical to frozen v1. All
machine arguments, OFF-only selection, prelaunch checks, native zero counters,
runtime/assets, host builder-Stopped checks, explicit Chrome requirement,
durable bounds and hidden-backend limitations are unchanged. Only transport,
source namespace/closure and the outer `defuss-m3b-device-observation-v2`
marker differ. This is neither M3b eligibility nor timing evidence.

No v2 tests, syntax checks or runtime execution have been performed by its
author. Root runs the following serially, retaining actual logs under a fresh
artifact path. Check all six `.mjs` files with `node --check` as well.

```sh
python3 -B scripts/with-tmp.py -- node --test experiments/m3b-device-observer-v2/test-graph.mjs experiments/m3b-device-observer-v2/test-transport.mjs
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-device-observer-v2/freeze.py --output artifacts/m3b-device-observer-v2-source-01 --test-evidence artifacts/m3b-device-observer-v2-tests-01.log
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node experiments/m3b-device-observer-v2/run.mjs --mode off --timeout 300000 --output artifacts/m3b-device-observation-02
```

Use actual retained `--test-evidence` paths; the freeze command does not create
the example log or infer success. It reuses the hash-pinned archived v1 freeze
primitives, copies the v1 closure, preserves the failed report and both source
reviews, verifies exact run/browser derivations plus unchanged graph/tests,
and includes all new local transport imports. Inputs and archives are
rehash-checked; exclusive outputs, fsync, project-local staging, publication
lock and failed-stage retention are inherited unchanged. Runtime binaries
remain checked by the observer itself. Root independently reviews the fresh
freeze before the second actual observation.
