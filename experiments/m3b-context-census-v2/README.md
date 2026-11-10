# Diagnostic context census ABI2

This new overlay extends the immutable M3b budget-1 prepared source with a
default-off census and a stopped generation-specific diagnostic injection API.
It changes no translation, chaining, admission, pool policy, guest instruction,
yield or function lifetime. It records value-only metadata at actual compiled
and TCI attempted entries, before the generic generated entry check. Internal
TCI targets handed to the outer dispatcher are counted there once.

`ABI.md` defines the ABI2 2400-word bank, four exact-PC slots, sticky mismatch and
saturation latches, stopped reset epochs and two-pass typed injection guards.
The previous PC-only injection export is unchanged. A normal non-fused owner
is fatal only for a watch requiring fusion; ordinary RF attempts are retained
separately and must reconcile with complete closed trace windows. These are
diagnostic observations, not retired instruction counts or timing evidence.

The authored source has not yet been compiled or executed. Root owns test,
freeze, preparation and SDK/guest execution. The next focused host command is:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-context-census-v2/test.py --report artifacts/m3b-context-census-v2-host-tests-01/report.json
```

The test compiles the actual adapter, core and typed API with ASan/UBSan,
extracts the actual patched compiled wrapper and both internal TCI cases, and
checks outer-hook placement and unchanged pool/service functions. Its mocked
QEMU state tests pointer validation, exact tier/site counts, generic entry
aborts, hot/fused handoff, context/owner mismatch, stopped reset and typed API
rejections. It does not replace a QEMU SDK build or real complete guest gate.
Compiler commands, copied excerpts and output are retained in project `tmp`.

The root-owned `experiments/m3b-context-proof-v2` tool composes this incremental
overlay with the parent M3b changes, freezes original and new sources, and
binds a real build only after independent source and post-build review.

The isolated ABI2 delta canonicalizes segment access flags and retains all raw
cache flags separately. It addresses the source-proven descriptor limit-nibble
variation observed in the failed ABI1 OFF gate5; it does not excuse that failure
or establish a successful ABI2 run. Native checks include the actual extracted
QEMU base/limit helpers, a synthetic SYSRET-vs-descriptor cache pair, every
semantic flag bit of all eight segment caches, and selector/base/limit changes.
All API, execution-hook, counter and lifecycle checks remain unchanged.
