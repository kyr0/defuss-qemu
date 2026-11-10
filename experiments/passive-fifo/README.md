# Passive FIFO experiment v1

This is an isolated, default-off implementation of the reviewed
[passive policy](../../docs/decisions/passive-fifo-retirement-design-01.md).
It has source and sanitized native contract validation. It has **not** yet
passed a QEMU build, real browser/guest correctness gates, owning-worker
snapshot execution, or a performance campaign. It promises no gain and does
not change `engine/`, shipped runtime files, M3 source04/build01, or prior
benchmark evidence.

The performance and diagnostic source variants have identical policy and
configuration. The diagnostic variant adds call/byte counters, peaks and an
owning-worker snapshot route. Diagnostic runs cannot supply timing acceptance.
TCI/admission/capacity metrics are **call counts**, not elapsed time; there is
no direct full-cap-duration or native-resident-memory measurement here.

## Policy and execution boundary

Only the existing already-hot dynamic-instantiation branch runs maintenance:
`get_instance_from_tb` has returned NULL, `inc_counter` has allowed promotion,
the TB has a nonzero Wasm body, and capacity has not yet been reserved. No
cached function-table index is held at that point. There is no new yield,
sleep, timer, countdown arming, forced GC, or generated-TB instruction hook.

For an eligible exact-Asyncify-Normal attempt, validate the owner accounting,
consume only GC callbacks already delivered to that worker, and then remove
exactly256 oldest live records if charged occupancy is9000..11999, pending
GC is zero, live count is at least512, and at least256 successful eligible
installations have occurred since the last soft batch. Installations include
reinstantiations. Demand saturates at256 and resets only on a soft batch.
Self-induced reinstantiation is therefore counted as demand, not independent
workload evidence.

The factored unlink loop is the original `removeFunction`, clear-`tb_ptr`,
advance-ring loop. Charges stay in the pool until the original
`check_gc_completion` consumes delivered callbacks. The hard12000 CAS
reservation and original failed-reservation half-FIFO removal, GC check and
TCI fallback remain. Added proactive bursts are256; an unchanged emergency
burst may still remove half the ring. Off mode follows that original policy.

At quiescent single-owner snapshots, `charged = live + pending`,
`0 <= done <= pending`, and `charged <=12000`. An impossible accounting
state permanently faults the new policy; original execution/fallback remain.
Performance readback rejects such a run. A new installation can continue
using the original allocator after a rejected policy attempt, but it does
not increment eligible policy demand.

Eligibility requires x86_64 full-system PC, one actual guest CPU and
maxcpus1, the sole realized boot slot0, no ACPI/no unplug/no hotplugged CPU,
one TCG context, worker index0 and exactly one initialized worker, budget12000,
no plan/AOT mode, no coroutine, current owning CPU, and exact Asyncify Normal.
Unknown profiles stay on the old policy. The initial supported launcher is
`-machine pc,acpi=off -smp 1` with production hotness/admission settings.
Generic PC hotplug capability alone does not reject this fixed topology:
the possible-CPU list has one occupied slot and boot-slot removal/no-ACPI
unplug is rejected by QEMU. Q35 is outside the initial eligibility proof.

The normal CPU dispatcher and atomic fallback call graphs provide the scoped
nonnested ownership argument: this is not a general suspended-fiber reclamation
system. Asyncify Normal alone would not prove safety for arbitrary dormant
fibers. Real unwind/rewind and exact retirement-mutation checks remain required.

## Configuration and performance readback

All exports retain the `_defuss_fifo_` Emscripten prefix in JavaScript:

| Suffix | Contract |
|---|---|
| `abi()` |1 |
| `diagnostic()` |0 performance,1 diagnostic |
| `configure(0 or1)` |0 once before first vCPU execution; -1 invalid/repeated/late |
| `status()` | Atomic config bits enabled1, locked2, chosen4. Explicit off:0→4→6; on:0→5→7. Unconfigured default:0→2. |
| `state()` | Sticky bounded facts: ever eligible1, attempt observed2, accounting fault4, rejection observed8. |
| `rejections()` | Sticky reason bits below, recorded at the infrequent policy attempt boundary. |
| `data()` | Diagnostic64-word bank pointer;0 in performance. |
| `request(sequence)` | Diagnostic queued owner snapshot:0 accepted, -1 invalid/pending/nonpaused request, -2 unsupported owner; always -1 in performance. |

`reader.mjs` provides `configureFifo`, `readFifoPerformance` and
`readFifoSnapshot`. Performance acceptance requires the chosen locked config,
diagnostic0, data0, state3 and no rejection bits when on; off requires state0
and no rejection bits. Requested-on with no eligible attempts is insufficient.
These bounded facts are shared control state, not an execution counter table.

## Stopped owning-worker diagnostics

The initial worker pins one CPU object reference before release-publishing
its pointer and immutable initial eligibility. That diagnostic runtime-lifetime
reference protects host acquisition; it is not a TB/function/instance ref.
The host request does not walk the QEMU CPU list or read worker TLS. It checks
the pinned owner, fixed eligibility, one initialized worker, paused/stopped
state and a single outstanding strictly increasing nonzero32-bit sequence.
Each queued work item owns an additional CPU ref until completion.

`async_run_on_cpu` wakes the stopped owner through QEMU's ordinary work queue.
Nonexclusive queued work runs under the worker's BQL scope before guest
execution is permitted. The callback rechecks topology, owning thread,
stopped/nonrunning state, exact Asyncify Normal and request identity. It reads
the owner's TLS and release-publishes the copied result. It neither resumes
the guest nor consumes completed GC callbacks nor retires anything. Callbacks
delivered while stopped are included in a fresh owner read, rather than hidden
behind a stale cache. Waking the worker can affect callback scheduling, which
is another reason diagnostics are excluded from timing.

The host must confirm paused before and after, wait at most10seconds, retain
errors and never accept a cached completion or reuse a poisoned/timed-out
reader. It must not `cont` while the request is outstanding. Request IDs do
not wrap. Unsupported initial topology can reject before a snapshot exists;
this is explicit failure, not evidence of an inactive-but-valid snapshot.
An eligible off run can produce a valid accounting snapshot with disabled
reason bit14 and activePolicy false.

All words are unsigned32; word4 is interpreted as signed status. A64-bit
pointer from `data()` is range checked before conversion to Number. Shared
memory is obtained from exported `HEAPU8.buffer` when available or the
existing `pcProfileWords().buffer` accessor.

| Words | Meaning |
|---|---|
|0..3 | Magic0x46494631, ABI1, requested ID, release-published completed ID |
|4..7 | Status0/-2 rejected/-3 invalid accounting, config, CPU index, worker index |
|8..15 | Charged, live, pending, done, budget, demand0..256, diagnostic1, counter-saturated flag |
|16..39 | Counter order below |
|40..41 | Current effective-policy eligibility, current rejection reason bits |
|42..63 | Reserved zero |

Counter order: installs, softBatches, softRetired, emergencyBatches,
emergencyRetired, gcConsumed, reservationFailures, retiredEntryMisses,
admissionHeld, capacityTci, policyEligibleAttempts, policyRejections,
pendingGuards, asyncifyRejections, accountingErrors, wasmInputBytes,
importBytes, compiledCalls, interpretedCalls, softChecks, snapshots,
pendingPeak, chargedPeak, livePeak. These are cumulative; peaks are cumulative
maxima, not phase maxima. Counters saturate and make acceptance fail rather
than wrap. Input-byte counts measure newly instantiated module/import inputs,
including reinstantiations, not resident engine machine code.

Reason bits0..12: x86-full-system, PC machine, boot CPU, one CPU, max-one CPU,
one context, first worker, only worker, budget12000, no hotplug/ACPI, no plan/AOT,
not coroutine, current owner. Bit13: not Asyncify Normal. Bit14: disabled
(snapshot only). Bit15: latched accounting fault. Snapshot bit40 describes
eligibility at the snapshot, while performance state records historical
attempt/rejection/fault facts; neither alone proves a soft batch happened.

## Preparation and validation

Run from the project root. Output directories and adjacent overlay manifests
must both be fresh. `--check` verifies anchors without copying source.

```sh
python3 -B experiments/passive-fifo/prepare.py --variant performance --output artifacts/passive-fifo-source-01/source --check
python3 -B experiments/passive-fifo/prepare.py --variant diagnostic --output artifacts/passive-fifo-diagnostic-source-01/source --check
python3 -B scripts/with-tmp.py -- python3 -B experiments/passive-fifo/test_contract.py
node --test experiments/passive-fifo/reader.test.mjs
```

Omit `--check` only to prepare the corresponding fresh build source trees.
The generator pins the reviewed baseline files, copies the tree, modifies
three QEMU files and adds four overlay files. All scratch from native checks
is retained under project `tmp`; no real QEMU build or guest is part of them.
Native tests compile the actual overlay and extracted patched pool functions
against explicitly named QEMU/Emscripten stand-ins under ASan/UBSan. They
exercise charge retention/completion consumption, pending guard, cap/fallback,
configuration CAS races, topology/fault rejection, ring wrap, and queued
read-only snapshot invariants. They cannot establish actual browser GC,
Asyncify transformations, QEMU scheduling or guest correctness.

Before any performance claim: independently review/freeze source, build both
variants, prove native eligibility and owner callback operation in a real
guest, observe actual256 retirement and unchanged charged accounting until
natural callback delivery, exercise fault/SMC/state/interrupt/continuation and
unwind/rewind safety, and compare resource costs. The failed earlier M3
pressure test (TB flush before retirement) supplies no retirement acceptance.

Prospective timing follows the
[finite-horizon design](../../docs/decisions/passive-fifo-finite-horizon-design-01.md):
startup through completion including all20 warmup and32 measured batches,
fresh pilot/planning and independent confirmation, unchanged budgets and
failure policy. This new experiment cannot rescue or reinterpret the earlier
MSG2 selection result.
