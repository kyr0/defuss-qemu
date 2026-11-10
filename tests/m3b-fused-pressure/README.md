# Bounded natural lifetime of a fused owner

This new fixture has no executed guest, browser capture or lifetime replay yet.
The previous17-file source passed13 synthetic host tests and12 syntax checks
in `artifacts/m3b-fused-pressure-host-tests-02`. Those exact bytes are preserved
in `artifacts/m3b-fused-pressure-before-input-closure-fix-01`. The current
baseline-inventory/input-verification changes and two added synthetic tests
remain unexecuted until the next root-controlled host check.
The old pressure fixture, failed captures, frozen ABI1/ABI2 sources and all
45-gate baseline evidence remain unchanged. The source freeze and launcher
require a passed independent ABI2 baseline review bound to the exact runtime.
A source review or synthetic bank is not a lifetime result.

The unchanged ABI2 diagnostic runtime uses the guarded one-CPU private-RAM
profile, M3a and census enabled, M3b explicitly OFF or ON, hot1500/flags3,
512MiB guest RAM and hard charged-instance cap12000. Translation storage is
explicitly256MiB. The inherited guarded CLI retains `-S`, `-no-reboot` and
`-global apic.vapic=off`; it adds no execution logging or forced collection.
This is a256MiB correctness fixture, not production128MiB or performance
acceptance. OFF provides an ordinary-owner control; only an ON pass witnesses
a fused owner's compiled reinstantiation.

The static sentinel has a four-byte MOV/XOR prelude and a12-byte five-instruction
CMP/JZ + ADD/SUB/JMP two-block owner. Its operands are ordinary arguments;
the C multiplication oracle checks every call. The guest preserves the old
bounded pressure work: eight100000-iteration sentinel calls, up to12000
immutable ordinary generated loops in batches64, and at most16 sentinel
revisits with ordinary one-second guest nanosleeps between attempts. The
20-minute execution deadline never changes these work bounds. The image
builder checks exact ELF bytes, symbols and disassembly, the real copied
predecoder's five-instruction sentinel admission, and rejection at six entry
points in each generated loop. These are host byte-shape checks; actual native
selection still has to pass the capture.

At the layout stop, the host sets M3a/M3b sentinel and generated-range watches
once. Census watches only exact sentinel A and requires a fused owner in the
ON arm; all four reset epochs are exact. The host never resets these watches
again. Every stop retains96/128/256/2400 raw words before decoding, including
the unused idle boundary bank, and a bounded raw `x-query-jit` response with a
second confirmed paused status. Raw serial, stderr and chunk metadata are
fsynced before a stopped observation is interpreted and before its ACK.
There is no trace stream: any nonempty trace is rejected.

The lifetime proof has three parts:

- Warm compiled exposure occurs with no previous retirement, fewer than6000
  cumulative installations and charged count equal to installations. The
  sentinel is therefore in the first normal FIFO half-ring. Its actual
  canonical descriptor owner/generation/code/physical pages/context is retained.
- During churn, the sentinel is not called. Its cumulative watch and census
  banks must stay identical to warm. The first observed retirement must be
  exactly6000, and the guest stops churn at that gate. Global TB flushes after
  warm are fatal; translation-buffer capacity stays fixed and occupancy cannot
  decrease without a flush. Other global invalidations are retained monotonically
  without attribution; any subsequent sentinel owner/context change is fatal.
- Revisit acceptance requires a positive new compiled sentinel count after
  retirement, the same canonical descriptor tuple, and cumulative installations
  above both the retirement snapshot and12000 while charged count remains at
  most12000. The fixed cap implies completed natural reclamation released
  capacity. This does not attribute exactly one global install or a particular
  GC callback to the sentinel. In ON, ordinary RF compiled entries cannot
  substitute for fused compiled reentry; fresh TCI entries alone do not pass.

At every observation, all compiled sentinel census attempts equal M3a selected
attempts, and fused compiled/TCI categories equal the M3b watched tiers. B
attempts pay exactly one service turn. ABI2 preserves raw segment encoding
copies while comparing exact selector/base/limit/access semantics. A changed
owner, generation, code pointer, page mapping or semantic context fails. No
native entry is called a retired body, and no `F+R+D` logical-body partition is
claimed without execution traces. Guest multiplication checks remain necessary.

If the guest remains correct but no selected compiled reinstantiation appears
within16 revisits, the outcome is `incomplete` (exit2). It is retained, never
replaced by an extended run or forced GC. Failure stops ACK/cont and preserves
the raw observation. The browser must finally be paused, drained and closed;
input/runtime/source hashes and the stopped compiler-VM condition are rechecked.
This test does not prove suspended-function safety, natural interrupt state,
alias-SMC recovery, full XSTATE preservation, resident native-code memory or
speed improvement.

The builder binds the pinned SDK invocation, exact ten source dependencies,
three copied compiler inputs, GCC/nm/objdump identities and all nine command
results. The host independently validates these and the rootfs pin. The source
freezer binds the unchanged ABI2 runtime/source review, the actual accepted
baseline review and every exact identity in its complete inventory. Runtime
preflight and offline replay require that inventory to be present unchanged in
the frozen dependency map and verify all of it. Identity-only dependencies are
stream-hashed without storing historical trace buffers. Actual parsed metadata
and served assets still use verified real bytes; no empty-buffer stand-ins are
used. A metadata-cache hit requires the same file identity/stat stamp, and the
final full input rehash remains mandatory.

The shared frozen `m3b-context-inspection-v6/input-bound.mjs` keeps the default
128MiB metadata bound and every explicit lower bound. Only canonical
`artifacts/<directory>/native-trace.log` with mandatory exact SHA/byte identity
may reach512MiB as retained historical provenance. This does not change this
fixture's no-trace rule, live stream/queue limits, guest work, runtime or lifetime
criteria. The same-code offline replay rechecks raw chunk hashes,
serial/progress/ACKs, native lifetime conditions and all provenance. A separate
independent outcome review is still required.

Prospective commands for the new source revision (root serializes execution;
the test command previously ran against the retained earlier bytes):

```sh
python3 -B scripts/with-tmp.py -- node --test --test-concurrency=1 \
  tests/m3b-fused-pressure/test-guest-contract.mjs \
  tests/m3b-fused-pressure/test-oracle.mjs

python3 -B scripts/with-tmp.py -- python3 -B tests/m3b-fused-pressure/freeze.py \
  --output artifacts/m3b-fused-pressure-source-01 \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --baseline-review artifacts/m3b-context-v2-baseline-review-01/review.json \
  --test-evidence artifacts/m3b-fused-pressure-host-tests-03/report.json \
  --dependency tests/regions-pressure/fixture.c

python3 scripts/sdk.py python3 tests/m3b-fused-pressure/build.py \
  --output artifacts/m3b-fused-pressure-fixture-01

python3 -B scripts/with-tmp.py -- node tests/m3b-fused-pressure/run.mjs \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --fixture artifacts/m3b-fused-pressure-fixture-01 \
  --source-manifest artifacts/m3b-fused-pressure-source-01/manifest.json \
  --source-review artifacts/m3b-fused-pressure-source-review-01/review.json \
  --enabled 1 --timeout 1200000 --output artifacts/m3b-fused-pressure-on-01

node tests/m3b-fused-pressure/inspect.mjs \
  --run artifacts/m3b-fused-pressure-on-01 \
  --output artifacts/m3b-fused-pressure-replay-01
```

The freezer loads only the exact hash-pinned ABI2 proof helper from native
source manifest `c804956c31d854103c8dae13ca088a93ab31a692fe011d5745d9f787b27826cb`.
The accepted baseline may use a separately reviewed newer host window bound;
its runtime binding must remain exactly the ABI2 binding above. Every named
prerequisite must exist and pass before a dependent command executes.

The old pressure C fixture read by the preservation test is a mandatory freezer
dependency, even if the redundant explicit CLI dependency is omitted. Offline
replay independently checks the recorded preRun flags/ABI and the exact retained
SDK completion bytes against both their digest and the original completed wrapper.

`fullCapWithoutNewCompiledObservation` reports only a full charged pool with
no new compiled sentinel selection. It does not infer positive TCI execution
from the absence of compiled entries and is not an acceptance criterion.
