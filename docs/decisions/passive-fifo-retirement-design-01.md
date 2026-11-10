# Passive FIFO retirement before the charged-instance cap

Design frozen 7 November 2026, before implementation or candidate measurements.
Status: proposed only. No runtime, overlay, fixture or frozen campaign changes
are part of this document. The initial candidate is deliberately passive:
**no new sleep, yield, timer, dispatch-countdown arming or GC request**.

## Evidence and scope

The independent [pool audit](../../artifacts/m2-sustained-pool-audit-01/review.json)
examines all416 stopped warmup/measured rows from eight fresh sustained-v2 VMs.
Every VM reached12000 charged instances and later showed one observed net
drop. Every integer and JSON maximum fell between the first observed cap and
that drop. Integer maxima were5.623–9.407s, versus per-VM medians405–466ms;
JSON maxima were12.308–14.749s. These are retained observations, not exclusive
attribution to GC, TCI, compilation or retirement. Charged counts are net
snapshots; they do not reveal the number or timing of individual callbacks.
The same audit records substantial host compressor/swap occupancy. That remains
a possible contributor. The inadequate sustained-v2 pilot and its unselected
MSG2 result remain unchanged.

The measured pool implementation is byte-identical to
[`engine/qemu/tcg/wasm64.c`](../../engine/qemu/tcg/wasm64.c):
SHA256 `5e29482b963cb949ca2cb322dd850fe1d4fcf1df181384ddd4da086b4c62cf05`.
This source defines the proposed insertion points and invariants. The existing
M3 engine source04/build01 and main fixturev5/pressure fixturev2 stay immutable.
Any candidate and diagnostics require fresh source/build identities.

Initial supported profile: Chrome, x86-64 full-system execution, one vCPU,
one TCG context, one vCPU worker, normal dynamic translation, actual native
`instance_budget ==12000`. Other profiles retain the existing policy. In
particular, the smaller Bun/JSC MEMORY64_2 budget is not scaled into these
constants. A local zero pending count says nothing about another worker;
single-worker eligibility is an explicit prerequisite, not an inference from
that count. Plan/AOT, multi-context and additional architecture profiles need
separate validation before enabling this policy there.

The native eligibility test must establish TARGET_X86_64 full-system mode,
`current_machine->smp.cpus ==1`, `max_cpus ==1`, exactly one CPU object with
hotplug excluded, one TCG context, worker index0 and exactly one initialized
worker, actual native budget12000, and disabled plan/AOT state. One TCG context
alone is insufficient: round-robin execution can share it across guest CPUs.
Check current facts at maintenance, not just the first worker's initialization;
unknown topology/mode or nested/coroutine guest execution disables soft work.

## Existing ownership and collection boundaries

| Source boundary | Existing behavior and consequence |
| --- | --- |
| `instantiate_wasm` | Registers the exported `start` function with the worker's `FinalizationRegistry`, then obtains a function-table index. A registration is not a completion. |
| `add_instance` | Adds one FIFO record and publishes its existing TB-to-slot pointer. The charged reservation already exists. |
| `reserve_instance` | Atomically increments the shared charge only while below the actual native budget. This is the hard capacity authority. |
| `remove_old_instances` | Runs only after failed reservation. If local pending GC is nonzero it does nothing; otherwise it removes half the live FIFO, clears each slot's owner pointer, advances the FIFO and adds to pending GC. It does not decrement the charge. |
| `check_gc_completion` | The only charged-count decrement: consumes completed callbacks and subtracts the same count from pending GC. |
| `get_instance_from_tb` | A retired/reused owner mismatch clears the stale pointer and resets the TB counter to the normal hotness threshold. That does not bypass pressure admission. |
| `inc_counter` | At charged9600/10800/11400 with hot1500, admission can require6000/24000/96000 executions. A newly retired useful block can therefore spend considerable time in TCI even with some free capacity. |
| `trysleep` | Every50000 dispatcher iterations it sleeps/polls only at the full cap. The initial candidate leaves this code and cadence unchanged. |

Generated cross-TB transfers in `tcg_wasm_out_goto` store the target TB pointer
and return to the dispatcher; they do not retain another TB's dynamic function
index. A self-loop stays inside the current function. The reviewed generated
JS `removeFunction` deletes the weak-map entry, clears both the actual function
table slot and its mirror, then releases the index. Existing retained-owner
checks must remain before every later call. If composed with M3, retirement
must also retain its existing generation-zeroing and retirement diagnostics.

## Frozen first-candidate constants and switch

| Parameter | Fixed value |
| --- | --- |
| Policy name | `passive-fifo-v1` |
| Default | disabled; independent of MSG2 and M3 selection |
| Soft charged threshold |9000, i.e.75% of the unchanged12000 cap |
| Soft retirement batch |256 oldest live FIFO records |
| Minimum live records |512; never remove the entire live queue |
| Minimum successful installations between soft batches |256 |
| Simultaneous pending retirement episode |one; any positive pending count blocks another soft batch |
| Additional yield/GC behavior |none |
| Configuration |chosen before vCPU startup; atomically locked with first worker initialization |

9000 leaves3000 charged slots of headroom and starts below the9600 admission
step.256 limits each added synchronous removal burst to about2.1% of the hard
cap. These numbers are an initial hypothesis, not observed optima. Changing
either number after seeing candidate data creates a new candidate/version.

The native state is fixed-size: an immutable choice/lock word plus a small
worker-local saturating installation counter in0..256. Each successful
installation increments that counter only when the supported policy is active;
a reinstantiation counts too. A soft retirement resets it to zero. Reset rather than subtract: installations
accumulated before the threshold must not fund many later retirements of a
stable working set. No executable cache, TB map, owner reference or persistent
function index is added.

At a coherent quiescent supported-worker snapshot with no reservation in
flight, require `charged == live + pending` and `0 <= done <= pending`.
Completed callbacks still belong to pending until consumed. Impossible states
must fail diagnostic validation; never wrap a counter or manufacture capacity.

## Exact insertion point and ordering

Use the existing dynamic instantiation branch of `tcg_qemu_tb_exec`: after
`get_instance_from_tb` returned NULL, after `inc_counter` allowed promotion and
after the nonzero `wasm_size` check, immediately before `reserve_instance`.
At this point there is **no cached callable TB function index** to invalidate.
Do not move maintenance after a successful lookup and keep calling its old
index. Do not retire in `add_instance`, inside a guest helper, during a generated
function call, or from a main-thread timer.

Proposed control flow, not implemented code:

```text
existing compiled-hit path: unchanged
existing cold/admission-held TCI path: unchanged
existing no-WASM retiering path: unchanged

ready dynamic instantiation, no cached function:
    if passive policy has the supported single-worker profile
       and the current Asyncify state is Normal:
        consume already-completed GC callbacks
        charged = read shared charge
        live = existing FIFO distance(begin, end)
        if 9000 <= charged < 12000
           and pending_gc == 0
           and live >= 512
           and successful_installs_since_soft >= 256:
            synchronously retire exactly256 oldest FIFO records
            pending_gc += 256
            successful_installs_since_soft = 0
            // charged is unchanged

    execute the existing atomic reserve_instance()
    failure: existing remove_old_instances/check_gc_completion/TCI path
    success: existing instantiate/add-instance/call path
```

The implementation may factor the existing FIFO unlink loop into a shared
helper taking an explicit count. Off mode must still retire exactly its old
`live/2` count on failed reservation, with identical pending and charge rules.
The on-mode emergency full-cap branch also remains unchanged. Thus all **new
proactive** bursts are bounded256; the baseline emergency half-ring burst is
still possible. This design does not claim globally bounded retirement bursts
or guaranteed avoidance of the cap.

Polling first is necessary: completed callbacks can already be sitting in
`instance_done_gc` while the C-side charge still reports pressure. Consume only
that completed count; never subtract on unlink, on timeout or on the assumption
that `removeFunction` freed memory. Polling after admission intentionally means
that a held/cold TB may wait before reaching this new opportunity. Existing
full-cap polling remains its fallback. Moving polling ahead of admission, adding
a poll-only arm, or adding earlier yields are separate later experiments if
the initial diagnostic evidence warrants them.

## Safe point, Asyncify and stale references

The proposed site is the same dispatcher activation and before-call boundary
where existing reservation failure can already retire instances. The removal
helper is synchronous: finish table removals, slot clears, FIFO updates and
pending accounting before returning. It contains no suspension or callbacks
that run the guest, and retains no slot/function reference for later use.
The full-system call site is `cpu_tb_exec` in `accel/tcg/cpu-exec.c`; the MTTCG
and round-robin worker loops call `tcg_cpu_exec`, and process atomic fallback
after that call returns. This supports the ordinary sequential worker scope;
it does not authorize arbitrary reentrant TCG callers or dormant guest fibers.

Check `Asyncify.state == Asyncify.State.Normal` at this infrequent instantiation
maintenance boundary, using the exact reviewed runtime convention; its existing
unwind-only predicate also returns true while rewinding and is not sufficient.
Do not change `call_wasm_tb`'s `do_init` behavior, generated spill banks,
instruction-search recovery, nonlocal exits or rewind control flow. No new
after-call cleanup/reference count is proposed: a guest fault can bypass it.

Normal Asyncify state is necessary but does not prove that arbitrary dormant
fibers have no retained generated-function frames. Eligibility remains the
reviewed ordinary single-vCPU worker call graph; nested/reentrant TCG or guest
execution inside another suspended coroutine is outside this first profile.
Before promotion, audit that call graph and demonstrate that unwind/rewind does
not run retirement or charge consumption twice. Source reasoning alone does
not establish exact suspended-continuation safety. A speculative general
coroutine reclamation scheme is not part of this change.

No live TB is semantically invalidated simply because its instance is retired.
An old TB's existing slot pointer can remain until its next lookup; the owner
and M3 generation checks, where present, must reject the retired/reused slot
before calling a table entry. Same-TB loops are not interrupted halfway through
a generated function to perform maintenance. With only this supported worker,
no second dispatcher can retire its currently executing function.

## Diagnostic and correctness gates before timing

Use fresh diagnostic artifacts, not the timing runtime, to retain exact stopped
live/charged/pending/completed counts and cumulative successful installations,
soft/emergency batches and records, consumed GC callbacks, reservation failures,
retired-entry misses/re-promotions, admission-held TCI and capacity-failure TCI.
Separate those two TCI causes. Record transient module/input/import bytes and
reinstantiation costs; lower live occupancy is not proof of lower compilation
or memory cost. Any timing/iteration instrumentation remains absent from the
uninstrumented comparison artifact.

The FIFO indices and pending/done counters are worker TLS. Reading a C export
on the main thread would read the wrong TLS. Diagnostics must execute a short
synchronous snapshot on the validated owning worker while QMP confirms the CPU
stopped, then return an immutable copied record tagged with owner/request
identity. This samples callbacks already delivered on that worker's event loop;
queued callbacks not yet delivered are not counted as completed. A cached bank
updated only when C consumes callbacks is insufficient. Missing/extra owners,
late replies or a non-stopped CPU reject the snapshot. This requires a narrow
diagnostic-only worker route; it does not authorize a new guest execution path
or a main-thread read of worker-local counters.

Use the existing QEMU `async_run_on_cpu` work queue for that route. Its queued
work calls `cpu_exit`/`qemu_cpu_kick`; `cpu_thread_is_idle` notices pending work
even for a stopped CPU, and CPU event processing services it before
`cpu_can_run`. The callback rechecks owner/self-thread, paused state, immutable
topology and request identity, reads without consuming GC or retiring anything,
then release-publishes a copied record. Bound the route to one pending request;
reject stale IDs, wrap, wrong owner and timeout. A direct JS worker message can
stall behind a paused pthread and is not the chosen mechanism. Diagnostic
wakes may perturb natural callback scheduling, so they are absent from timing.

Required actual execution gates:

- Off mode preserves legacy half-ring behavior. On mode retires exactly256 per
  soft event, respects the256-install demand guard, and cannot retire again
  while any earlier episode remains pending. At every snapshot, charged is at
  most12000; within an installation-free interval unlink alone changes no
  charge, and consumed callbacks change pending and charged by the same count.
- Revisit real previously selected immutable code after normal FIFO retirement;
  require exact state answers through cap/admission fallback and eventual
  selected reinstantiation if natural GC permits. Preserve an explicit
  incomplete outcome if callbacks make no progress; never force collection or
  raise capacity to pass.
- Run the real state/flags/SIMD, separate fault-class, isolated active-SMC,
  interrupt and blocking-continuation checks. Add exact retirement/consumption
  mutation counts across a real maintenance-adjacent suspension/rewind, rather
  than relying only on final architectural state.
- Keep a stable selected working set with no successful new installations:
  it must not continue to lose batches. Test the supported-profile guard and
  disabled mode; unsupported contexts retain the legacy policy.

Frozen pressure fixturev2 is bound to source04/build01 and its first6000-slot
retirement proof. It must reject the new runtime, not be edited to manufacture
a pass. A fresh policy-specific fixture can use cumulative FIFO retirements
reaching the stopped warm gate's installation upper bound to prove its sentinel
has left the original ring; all intervening flushes/text changes invalidate that
proof. Archive that new contract and exact candidate hashes separately.

## Prospective hypothesis and decision limits

**H1, fixed before candidate data:** passive completed-callback consumption and
small FIFO batches begun at9000 charged instances reduce the recurring full-cap
episode and its retirement/reinstantiation work enough to lower sustained
application time. The policy may fail if ordinary event-loop opportunities do
not deliver callbacks before the3000-slot headroom is consumed, or if evicting
useful code increases admission-held TCI/compilation more than it saves.

The mechanism is supported only if independent diagnostic runs show real soft
retirements, retained pending charges, natural completion and fewer/shorter
full-cap episodes without hidden state/exit failures. Net pool drops or a
smaller stopped count alone are insufficient. Continued full-cap episodes,
unconsumed callbacks, worse retired-entry TCI, or increased emitted/instantiated
bytes can falsify the intended mechanism even if one endpoint happens to run
faster.

Use a fresh independent experiment identity with MSG2 held off in both arms.
The [finite-horizon measurement design](passive-fifo-finite-horizon-design-01.md)
defines the primary as browser monotonic time from immediately before the first
VM asset/startup work through the completed gate's confirmed stop/read. It
includes capture readiness, all20 warmup and32 measured batches, calibration
and every ACK gap. All52 phase intervals and all four combined1300-call endpoint
totals have regression guards; moving work into warmup cannot hide its cost.
Pair whole fresh captures; nested batches are not independent samples. Preserve
the original operation source, all observations, host isolation and failures.

The prospective useful-effect threshold remains at least5% lower primary time;
the linked design preserves numeric regression/service/resource budgets and
declares multiplicity and fresh pilot/planning rules. It does not reuse the old
MSG2 pilot for confirmation. Runtime/package identities and the final analysis
plan must be frozen before new measurements. A fresh four-pair exploration may
size independent confirmation, never promote this candidate. All claims remain
conditional on real correctness gates and independent uninstrumented evidence.
