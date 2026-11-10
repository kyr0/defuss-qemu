# M3b budget-1 fallthrough experiment

Status: implemented source with passing host checks, still awaiting the SDK
QEMU build and real M3b guest validation. Root's retained
`artifacts/m3b-safe-gap-host-tests-03` passed nine provenance tests, six overlay
contracts (including the actual service and boundary helpers under ASan/UBSan),
25 JavaScript fixture tests, syntax checks and exact preparation anchors for
19 patched and nine copied files. The anchor check used the unpinned graph.
The unchanged bounded parser retains its passed plain/sanitizer checks in
`artifacts/m3b-predecode-tests-02`. These results do not validate generated guest
execution, the new native machine eligibility checks or actual Asyncify.
This new directory must preserve the baseline, frozen M3a source04, passive
policy and all timing sources. The proposed source base is the retained M3a
source04 tree, copied to a fresh artifact only by `prepare.py` after verifying
its complete retained fingerprint. Inputs and adjacent existing output
manifests cannot be overwritten.

The bounded first stage joins one conditional block A and contiguous block B
under one ordinary TranslationBlock owner. B ends with a backedge to A; that
backedge must return to dispatch after exactly one traversal. It preserves
ordinary register synchronization and does not claim architectural-state
retention or completion of the full PLAN M3b gate.

See the new [budget-1 decision](../../docs/decisions/m3b-fallthrough-budget1-01.md)
for exact constraints and unresolved integration points. The existing design
and `artifacts/m3b-feasibility-review-01/review.json` remain unchanged.

The separate [provenance tool](PROVENANCE.md) has passed its nine host tests;
actual source freezing, post-build recheck and runtime binding remain pending.
It does not publish an independent review or claim a successful build.

The byte parser is only an admission filter. Actual QEMU decoded operands,
emitter identity and instruction length are checked before lowering; completed
IR with any helper, guest-memory operation or indirect jump rejects. This
deliberately rejects some accepted byte forms (for example64-bit IMUL's helper
fallback and a Jcc that must compute dynamic flags). One failed trial discards
all IR and retries ordinary translation with the original instruction limit.
QEMU's page-lock retry -3 remains unchanged.

The diagnostic profile requires PC/acpi=off,hpet=off,usb=off and
`-global apic.vapic=off`, one fixed boot CPU,
512MiB private RAM, no slots/backends/NUMA and an initially stopped launch.
Actual OFF-only observation03 retained 26 devices, no kvmvapic and effective
APIC `vapic=false` in `artifacts/m3b-device-observation-03`. Its exact graph and
memory-backend evidence supply the independent graph pin; that pin and review
must precede the final source freeze. Unpinned configuration rejects enabled
mode with -3. The ordinary production profile cannot enable fusion.
A graph observation from the frozen
M3a runtime does not prove the new lifecycle fences: the new runtime must
independently reproduce and check the pin before an enabled run.
The observed older OFF graph contained kvmvapic and is not eligible for pinning:
APIC delivery can write its guest RAM page. The new source requires exactly
one CPU-owned APIC with effective vAPIC disabled, null vAPIC device, zero vAPIC
address and no kvmvapic graph row. A central pre-mutation veto prevents later
vAPIC activation. The IOAPIC address-space pointer must be the ordinary system
memory space; its reviewed fixed high APIC destination cannot overlap the
admitted512MiB low RAM. The new native guards still need actual eligibility and
rejection validation in the built M3b runtime; the old-runtime graph observation
does not exercise them.

See [ABI.md](ABI.md) for the stopped diagnostic contract and
[PREDECODE.md](PREDECODE.md) for the standalone decoder contract. Guest fixture
source and host contracts are under `tests/m3b-fallthrough`.
The separate [boundary facility](BOUNDARY.md) and `runtime-boundary.inc` are
integrated and covered by the passed native helper and JavaScript host tests.
Their generated-code/state oracle remains unexecuted. The separate256-word
bank preserves the current128-word ABI and is exercised by `tests/m3b-boundary`.
The new [standalone Asyncify contract](asyncify-contract/README.md) stages
actual emitted-WASM unwind/rewind validation using the same service source.
It is source only; its explicit capacity/context stubs do not stand in for a
natural-pressure VM run.

The retained host checks used the following entry points. Any later rerun needs
root's safe interval and a fresh artifact output where applicable:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-fallthrough/test-overlay.py
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-fallthrough/test-provenance.py
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-fallthrough/prepare.py --output artifacts/m3b-source-01/source --check
```

The native service contract compiles the actual service helper and original
maintenance function, but it does not implement Asyncify. Source anchor checks
do not validate generated code. Real compiled/TCI differential results,
intermediate state at B/backedge exits, invalidation/lifetime coverage, and
exact service accounting across actual suspension remain required. There is
no performance or PLAN completion claim.
