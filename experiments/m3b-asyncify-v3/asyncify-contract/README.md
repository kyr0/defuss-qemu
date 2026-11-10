# Standalone Asyncify revision3

Actual revision2 build passed, but run01 failed at the first real unwind because post-compilation wrapper references named a helper eliminated as unreachable by JavaScript optimization. The original generated module contains zero occurrences of that helper name; only the four derived call sites referenced it. Revision3 exports the existing observer function through the stable Module.m3bObserverTransition property before optimization, then derives its four wrappers through that property and checks the function exists before execution. It adds no yield and retains no callback. Contract C/core/service/trysleep and emitted-WASM compile flags remain unchanged from revision2. This revision is source-only until its own build and run are retained. All older source/build/run failures remain unchanged.

The remainder is retained earlier design/status context, not new evidence.

# Standalone Asyncify revision2

Revision1 build `artifacts/m3b-asyncify-build-01` is retained as failed: Emscripten rejects redundant MAXIMUM_MEMORY with disabled memory growth under -Werror. Revision2 removes only that redundant flag from build and exact-argv verifier, and changes the verifier source/SDK paths to this new directory. The default-disabled growth and64MiB initial memory remain unchanged. Contract C, observer JS, original service helper and extracted trysleep are unchanged. This revision is not built or run yet. All original frozen M3b sources remain unchanged.

The remainder below is the retained revision1 design/status context, not new execution evidence.

# Actual Asyncify service contract draft

The runner's JavaScript syntax check passed in
`artifacts/m3b-safe-gap-host-tests-03`. The same service source also passed the
separate native helper contract under ASan/UBSan, which does not implement
Asyncify. This standalone fixture has not yet been compiled with emsdk or
executed as Wasm in Node; no actual unwind/rewind result is claimed.
Root runs it only in a serialized execution gap. It never changes a QEMU runtime,
starts a guest, forces GC or adds a VM yield/threshold reset.

The builder copies the exact current `runtime-service.inc` and `core.h`, and
extracts the complete unchanged `trysleep` function plus its50000 threshold and
TLS declaration from frozen M3a source04. The capacity predicate, completed-GC
consumer and CPU context are explicitly stubbed. `emscripten_sleep(0)` is the
actual Emscripten import, not a host/native sleep stub. The fixture calls the
real helper for eight bounded cases: zero debt; one paid turn; cleared-debt
reentry; requested-exit debt at full-capacity threshold; available-capacity
threshold; a second full-capacity sleep; invalid debt; and another cleared
reentry. The test alone seeds its local countdown/capacity; the VM does not.

Pinned emsdk compiles memory64=1, pthread-capable Wasm at O2 with actual
Asyncify. This standalone export runs on its Node caller thread, not a QEMU
vCPU worker; the pthread option preserves shared-memory/TLS compilation but
does not establish worker scheduling or dormant-fiber safety. Its64MiB linear
memory is sufficient for this contract and is not a VM configuration.

A separate observed JS artifact changes exactly four generated glue call
sites around native start/stop-unwind and start/stop-rewind. Wasm bytes remain
unchanged. The observer uses the original native `asyncify_get_state` captured
before export wrapping, never the unsafe wrapped export while unwinding.
It retains at most32 scalar transition rows, fails on nesting/overflow, and
does not retain a callback in its log. Every transition records the native
before/after state and exact32-word C bank before/after the native state call.
No observer yield is inserted.

Acceptance requires exactly two ordered native0→1→0→2→0 episodes, debt already
zero at every event, exact service/B-request/return/completion counts during
both suspended intervals, and exact final values after the second resumed C
continuation and subsequent negative cases. This can falsify duplicate helper
payment or completion in this real Asyncify contract. It does not substitute
for actual M3b generated-code, owning-worker, natural-pressure or full-state
VM evidence. A no-sleep VM boundary snapshot cannot claim these episodes.

Both compile and run outputs are fresh immutable artifact directories. The
builder retains copied source, original and derived JS, unchanged Wasm, exact
compiler argv/output/version/hash, source hashes and SDK start record. The
runner requires the wrapper's successful completion, checks exact offline SDK
argv, replays the four JS derivation anchors and rehashes inputs before success.
Async module/compile/factory startup and the actual C call each have a60s
deadline. Root should also bound the outer Node process to cover filesystem or
synchronous engine failure; an inner timer cannot interrupt a blocked JS thread.
Scratch is the unique project `tmp` directory supplied by `scripts/sdk.py` or
`scripts/with-tmp.py`; failed outputs remain retained.

Prospective commands, after source review and root authorization:

```sh
python3 scripts/sdk.py python3 experiments/m3b-fallthrough/asyncify-contract/build.py --output artifacts/m3b-asyncify-build-01
python3 scripts/with-tmp.py -- node --experimental-wasm-memory64 experiments/m3b-fallthrough/asyncify-contract/run.mjs --build artifacts/m3b-asyncify-build-01 --output artifacts/m3b-asyncify-run-01
```

The real installed Node must support the selected memory64/shared-memory
module. Unsupported engine/glue anchors are retained failures, not permission
to substitute a model test or silently change memory mode. No performance or
PLAN completion claim is made by this fixture.
