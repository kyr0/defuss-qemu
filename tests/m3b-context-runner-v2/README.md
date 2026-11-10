# M3b context-census v2 capture

This new adapter requires the separately built `m3b-context-census-v2`
diagnostic runtime and reuses the unchanged 45-gate fixture image. Earlier
M3b, census-v1 and forensic-v1/v2 sources and failed reports remain immutable.
Native v2 sanitizer checks passed at
`artifacts/m3b-context-census-v2-host-tests-01/report.json`. This adapter's host
checks, native runtime build and real captures remain pending at authoring. No timing or promotion claim is made.

The v1 OFF01 capture stopped at gate5 on a native sticky context fault. Its
first recorded difference was redundant CS/SS descriptor-limit bits, but that
first-fault record cannot prove every later context. V2 requires a fresh ABI2
runtime and capture. The2400-word bank retains raw segment flags separately
from canonical access flags (`0x00f0ff00`); all selector/full-base/decoded-limit
fields remain exact. Full CPU dump rows remain validated and retained while
only semantic flags participate in context equality. No faulted v1 bank is
reinterpreted as passing. See the v2 accounting README and native ABI/source
review for the precise representation contract.

Both arms enable the census before the vCPU starts. Every paused gate retains
raw M3a96/M3b128/boundary256/census2400 banks before semantic decoding. The
census watches exact A only, while the existing M3a/M3b watches retain A and B.
Each gate configures exactly four new census epochs. Positive ON watches,
including warmup, require a fused normal owner. OFF and rejection-shape watches
permit ordinary normal owners and preserve the original validator.

For positive ON measured windows, `validateCensusContextWindow` requires the
complete attempted-entry census and the frozen guest CFG. The logical body
partition is fused B attempts + certified ordinary RF A-to-B continuations +
source-known initial direct-B calls. Requested B exits already belong to the
fused-attempt term. Ordinary B selected counts remain attempted entries and
are never presented as retired bodies. Every RF A attempt must have a complete
raw frame classified as a B transition, a terminal side transition or an exact
generic refusal. Unclassified or ambiguous continuations reject acceptance.
The raw normal/RF tuples bind owner generation, code/header, physical pages,
flags/cflags and execution context, including hidden normal entries. The warm
owner must remain stable. Final guest integer, flags and defined legacy FXSAVE
checks and every original digest/check total remain unchanged.

The prior closed forensic-v2 gate3 had486 fused B attempts and64 certified
ordinary RF A-to-B continuations with the expected550-body guest result. That
failed old-runtime capture remains failed. It cannot satisfy the new census
requirement or be retroactively accepted.

Capture and durability bounds are fixed before execution:

- Distinct report/factory argument arrays prevent Emscripten's program-name
  insertion from changing the declared command line.
- All eleven exact ELF extents are logged with `exec,in_asm,cpu`, without
  `nochain`. Total trace is bounded at512MiB, the raw producer queue at64MiB,
  and each stopped parse window at64MiB. Overflow fails; bytes are never dropped.
- Canonical base64 chunks contain at most64KiB. Data and contiguous hash/index
  metadata are fsynced before host acknowledgement. Gate drains require zero
  pending bytes and produced=queued=acknowledged totals; queue peaks and latency
  fields are retained. No VM yield, forced GC or emulated service turn is added.
- The layout-gate0 boot prefix is retained and hashed, but is not interpreted as
  64-bit user code. Subsequent windows start at the exact prior ACK offset;
  no user bytes are skipped. Each window is parsed while the VM remains paused,
  and its bounded summary is fsynced before the acceptance oracle runs.
- Oracle refusal sends no further ACK/cont. Page errors, deadlines and final
  pause failure retain failure evidence. An external owned-process deadline
  remains required for blocked host I/O or browser teardown.

`inspect.mjs` replays closed captures with the same reviewed oracle. It streams
all indexed chunks and parses one bounded window at a time, verifies the
combined source/runtime/image proof, raw serial sequence, bank epochs and
saved windows, and rehashes all retained inputs. This is same-code replay;
independent capture review remains a separate gate. Recovery, natural
retirement, general DMA correctness and full extended architectural state are
not established by this fixture.

The root-owned combined source freeze is authoritative. The local `freeze.py`
refuses a separate host-only freeze. The final manifest/review in the runtime
binding also bind these host sources. Future commands, only after the builder
stops and the final host source review/tests succeed:

```sh
python3 -B scripts/with-tmp.py -- node --test --test-concurrency=1 \
  tests/m3b-context-runner-v2/test.mjs \
  tests/m3b-context-runner-v2/test-transport.mjs \
  tests/m3b-context-runner-v2/test-trace.mjs \
  tests/m3b-context-runner-v2/test-windows.mjs \
  tests/m3b-context-runner-v2/test-oracle.mjs \
  tests/m3b-context-accounting-v2/test-contract.mjs \
  tests/m3b-context-accounting-v2/test-census-reader.mjs \
  tests/m3b-context-accounting-v2/test-integration.mjs

python3 -B scripts/with-tmp.py -- node tests/m3b-context-runner-v2/run.mjs \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --fixture artifacts/m3b-fixture-01 \
  --source-manifest artifacts/m3b-context-v2-implementation-source-01/manifest.json \
  --source-review artifacts/m3b-context-v2-implementation-source-review-01/review.json \
  --enabled 0 --timeout 1800000 --output artifacts/m3b-context-v2-off-01
# Repeat serially with --enabled 1 and a fresh artifacts/m3b-context-v2-on-01.

python3 -B scripts/with-tmp.py -- node tests/m3b-context-runner-v2/inspect.mjs \
  --run artifacts/m3b-context-v2-on-01 --output artifacts/m3b-context-v2-inspection-on-01
```

`DEFUSS_VM_CHROME` must name the reviewed Chrome binary. The fixed profile
retains512MiB RAM, `apic.vapic=off`, M3a enabled, hot1500/flags2 and cap12000.
All scratch stays under project `tmp`. Prospective artifact names above are
not evidence that a binding, build or real capture already exists.
