# Passive FIFO real diagnostic fixtures

This new runner is bound to diagnostic policy source01/build01 and root's
authoritative post-build audit. It preserves the frozen overlay, M3 sources,
existing images, and runtime bytes. Revision01 combined-off startup failed
before any gate: generated FIFO preRun loaded workers before the user callback
created the observer bus. The failed report and original source remain at
`artifacts/passive-fifo-combined-off-01` and `artifacts/passive-fifo-fixture-source-01`.
Revision02 fixes this initialization defect; its host checks do not establish
real guest safety or acceptance. No revision02 guest has run yet.

Three modes use production hotness1500, flags3, one x86 CPU,512MiB guest RAM,
the unchanged12000 instance cap, and a diagnostic256MiB translation buffer:

- `main`: exact retained main-v5 ELF/image. State/flags/SIMD,384 precise faults,
  alias and active-TB SMC with an exactly-once side effect, interrupts, and
  delayed-ACK blocked-read continuation. The old stage names mention injection,
  but this runner does not inject M3 metadata and does not use M3 APIs.
- `pressure`: exact retained generated-loop pressure ELF/image. Bounded12000
  loops in64-node batches and16 natural-GC retry opportunities. The on arm must
  observe at least two new256-entry soft batches and256 consumed callbacks
  after its warm gate. The off arm must observe new ordinary emergency
  retirement. Both require a complete observed Asyncify episode after armed
  retirement, followed by a coherent owner snapshot and arithmetic revisit.
- `combined`: a new initramfs runs those two exact ELF byte sequences in order
  in the same VM. Pressure must pass before the main segment is accepted.
  The no-global-TB-flush requirement persists from pressure warmup through
  completion of main; a flush is a failed proof. This may reject a legitimate
  execution and is deliberately not weakened after observing a run.

Main reports include start/end counters and deltas for soft batches/retired
entries, emergency retirement, GC consumption and compiled/interpreted calls.
Prior retirement is distinct from retirement during main. Global compiled
calls cannot establish per-function compiled exposure. Production admission
may keep particular main functions in TCI after pressure. These reports do
not prove eviction of a specific suspended instance or general dormant-fiber
safety. Application acceptance still uses its production128MiB translation
buffer in separate held-out tests.

## Fresh owning-worker snapshots

Every gate confirms QMP pause, queues the frozen native owner snapshot,
checks chosen/locked config and actual effective state3 for on (state0 off),
and retains the64 native words. Counters must be monotonic and satisfy:

```
charged = installs - gcConsumed = live + pending
pending = softRetired + emergencyRetired - gcConsumed
softRetired = 256 * softBatches
delivered = gcConsumed + done
```

The observer captures its epoch from the existing `fifo_asyncify_normal`
import inside the stopped owner callback, before the synchronous native TLS
copy. That worker cannot deliver a finalizer between the two copies because
there is no intervening yield. Host reads require the same fresh request ID.
Unrelated later deliveries cannot change the retained epoch. The owner wake
can affect scheduling, so all reports are explicitly ineligible for timing.

The stopped `x-query-jit` response and a second paused status are retained
before ACK. Capacity must match256MiB, occupancy must not decrease within an
epoch, and pressure/combined modes reject post-warm flushes. No forced GC,
capacity weakening, new guest loop, or native runtime yield is introduced.

## Named JavaScript observer derivation

`passive-fifo-async-observer-v2` is a separate diagnostic wrapper. Seventeen
exact anchors are checked in the actual generated JavaScript. The served JS
is derived in memory and retained as `derived-runtime.js`; its full derivation
record is retained separately. The WebAssembly and all runtime dependencies
are byte-identical to the reviewed diagnostic build. It must never be used
as the performance artifact.

The shared observer buffer is supplied as a factory option before any generated
worker-loading preRun callback. The user preRun callback publishes the native
bank address once using CAS in shared header word49 before vCPU execution.
Workers read this shared word, rather than a scalar property whose structured
clone would remain stale. Owner initialization/use rejects an absent, unaligned
or out-of-heap address. A regression test executes the actual generated FIFO
preRun/pool-loader bodies with structured-cloned worker messages and reproduces
both the old missing-bus failure and the corrected publication order.

Hooks cover both `Asyncify.handleSleep` and `Fibers` start/stop paths. The
observer captures the raw core `asyncify_get_state` export before Emscripten's
wrappers and checks both JS and raw native Normal at every actual removal and
installation. It does not call a wrapped state getter during unwind/rewind.
Transient JS/native state differences at the start/stop hooks are intentional.

Each registered dynamic export gets a unique numeric installation token as
the FinalizationRegistry held value; the callback maps it back to the original
`tbinstance` behavior. Only numeric metadata is stored. No generated function,
module or instance is retained by the observer. Slot reuse has a new token;
double removal/delivery and unknown lifetimes reject. Contiguous retirement
groups must be256 or6000, match native soft/emergency counters, and successive
soft groups require at least256 intervening installations. This detects an
extra post-resume batch even if it removes different instance IDs.

The first armed retirement opens a bounded16384-row trace, sufficient for the
off arm's6000-entry batch. It captures one subsequent matching unwind,
stop-unwind, rewind and stop-rewind episode, then continues through the next
coherent owner snapshot. The selected episode must have no extra installation,
removal or callback consumption between start-unwind and stop-rewind. The
later snapshot checks conservation and batch/demand rules after continuation.
Host-phase tags distinguish running, stopping, paused/snapshot and resuming;
the observed episode may be influenced by diagnostic pause/wake scheduling.
That limitation is preserved in the report.

There are at most12000 live/pending token records,64 active episode records,
and16384 trace rows. Overflow or duplicate episode keys fail; no required
trace events are silently dropped. Unresumed episodes are reported, not
claimed to have completed. Delivery trace rows occur before the original
`done` write, so exact delivery/consumption equality is asserted only at
coherent snapshots. The main loop/coroutine source ownership proof remains
necessary; a successful observed episode is not a general reclamation proof.

## Durable protocol and provenance

Each received marker, COM1 gate byte and ACK is recorded. At most223 stopped
rows (206 pressure plus17 main) are appended and fsynced before validation and
ACK. Directory entries are synced. Partial JSONL is not resumable acceptance.
Console output is bounded16MiB, a partial line1MiB, stderr1MiB/4096 rows, and
the VM deadline20minutes. A separate fixed120-second first-stopped-gate
deadline bounds startup. `events.jsonl` fsyncs each host/page/worker-console/
runtime-stderr event before its append resolves, with4096 records,64KiB per
record and2MiB total bounds. A pageerror or crash ends the run promptly after
its durable event; overflow fails the run. Worker creation/closure and forwarded
stderr are retained even when no gate is reached. Failures retain observations; complete reports and
derived files use fresh output paths.

Host replay decodes raw native/observer epochs, checks every marker/signal/ACK,
replays pressure decisions and exact main result counts, and rechecks the
translation epoch. Raw `serial.log` is independently parsed with unique
layout/start/completion/interrupt records. The main interrupt run count may
vary from1..128; its exact check totals are adjusted using that retained count.
Comparison rehashes raw serial, derived JS/metadata, input identities,
durable gate rows and event evidence; fatal events or a missing first-gate
event reject acceptance. Compiler VM state must be Stopped before and after a run;
the operator still must not start concurrent owned heavy work between checks.

`bind.py` consumes the exact root source-recheck, its inventory, reviewed
source manifest/reviewer and all seven distinct runtime files. It does not
repeat root's full source audit. Binding already retained at
`artifacts/passive-fifo-diagnostic-binding-01.json`, SHA256
`e1e3b9fc5c33ec45d92a5234d78272757f0c5a63a11d601e78c85612566dc7cc`.
Actual runtime JS SHA256 is
`c6694c0e715ce8d5bc76f07afbb5ef2adbbb2c56d557972ff0ce94e7733b9148`;
WASM SHA256 is
`6348388f393aedd442341427897ba51fadd9aca0dcd97600e4859ab7b228a79c`.

## Commands for the serialized validation owner

Host checks only:

```sh
python3 -B scripts/with-tmp.py -- node --test tests/passive-fifo/test-observer.mjs tests/passive-fifo/test-identity.mjs tests/passive-fifo/test-replay.mjs tests/passive-fifo/test-startup.mjs
```

The exact combined image is already retained at
`artifacts/passive-fifo-combined-fixture-01` and is reused unchanged. For a
future fresh packaging path, the source-only packager command is:

```sh
python3 -B scripts/with-tmp.py -- python3 -B tests/passive-fifo/build-combined.py --output artifacts/passive-fifo-combined-fixture-NEW
```

Run either arm in a fresh browser, serially; change `--enabled` and output for
the other arm. No browser/guest has been launched by these source checks.

```sh
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node tests/passive-fifo/run.mjs --runtime artifacts/passive-fifo-diagnostic-build-01/runtime/x86_64 --binding artifacts/passive-fifo-diagnostic-binding-01.json --image artifacts/passive-fifo-combined-fixture-01 --fixture combined --enabled 0 --output artifacts/passive-fifo-combined-off-02
```

For isolated main use image `artifacts/m3-region-fixture-02` and `--fixture main`;
for isolated pressure use `artifacts/m3-region-pressure-fixture-01` and
`--fixture pressure`. Use fresh output names. Exit0 means the stated fixture
passed,2 is bounded incomplete natural progress,1 is failure. Neither an
incomplete result nor a failed proof can count as acceptance.

```sh
node tests/passive-fifo/compare.mjs --off artifacts/passive-fifo-combined-off-02/report.json --on artifacts/passive-fifo-combined-on-02/report.json --output artifacts/passive-fifo-combined-pair-02.json
```

The combined packager verifies equal base files, exact input-image hashes,
both ELF hashes, and an unpack/repack round trip. It changes only init order
and executable path names in a new image. All scratch stays in project `tmp`.
