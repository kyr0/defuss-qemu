# OFF observer v3: exclude virtual-APIC guest-memory writes

Observation02 completed successfully and remains useful graph evidence. Its27
devices include `kvmvapic`, so it must not be pinned as an eligible M3b graph.
APIC interrupt delivery can invoke `apic_sync_vapic` and write guest RAM when
the virtual-APIC address is configured. The helper also contains guest-code
patching paths. This source-only revision requests `-global apic.vapic=off`,
requires exactly one local APIC belonging to the observed sole CPU, reads its
native QOM `vapic` property as actual false, and rejects any `kvmvapic` node in
the complete composition tree.

No v3 syntax check, test, freeze helper, browser or guest has been executed.
All v1/v2 sources, archives, failed observation01 and successful observation02
remain unchanged. V2's shared-buffer transport and transport tests are copied
exactly. Other machine arguments, original M3a runtime/assets, OFF selection,
prelaunch/zero-counter/empty-serial requirements, read-only command allowlist,
host builder-Stopped checks and explicit Chrome path remain in force. The
allowlist adds only the read-only native `vapic` property.

Only after root announces a safe gap, retain all outputs in fresh artifacts,
check all six `.mjs` files with `node --check`, and run:

```sh
python3 -B scripts/with-tmp.py -- node --test experiments/m3b-device-observer-v3/test-graph.mjs experiments/m3b-device-observer-v3/test-transport.mjs
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-device-observer-v3/freeze.py --output artifacts/m3b-device-observer-v3-source-01 --test-evidence artifacts/m3b-observer-v3-tests-01/report.json --test-evidence artifacts/m3b-observer-v3-tests-01/tests.log
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node experiments/m3b-device-observer-v3/run.mjs --mode off --timeout 300000 --output artifacts/m3b-device-observation-03
```

The example evidence paths must exist from actual root-run tests. The freeze
helper copies the complete previous source closure and archives, pins
observation02 without claiming it eligible, verifies exact launch/wrapper and
unchanged transport derivations, and includes all new local imports. It reuses
the archived, hash-pinned original freeze primitives: bounded selection,
no-follow stable reads, exclusive files/output lock, source/archive readback,
fsync and atomic publication from project-local `tmp`. It never runs tests or
infers pass status from supplied evidence.

QOM observation cannot prove all native invariants. Before fusion eligibility,
the new native profile must itself require the sole CPU's actual APIC
ownership, disabled vAPIC control bit, null helper and zero vAPIC physical
address; reject subsequent vAPIC enablement before mutation; preserve exact
device/object topology and private RAM; check every BlockBackend (including
unnamed unattached ones) is absent; and enforce lifecycle/control fences.
IOAPIC routing must remain the reviewed system-memory route. The prospective
graph pin remains uncreated until independent observation/source review.
Neither a successful observer nor this host fixture proves generated fused
code, internal B state, interrupt order, lifetime safety or real Asyncify.
