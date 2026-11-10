# M3b owning-worker service continuation

The fresh OFF/ON pressure captures and their offline replays passed. ON retained
the first **four compiled sentinel service suspensions**, each on the same
native vCPU pthread, with all four real native Asyncify transitions, unchanged
captured state and exactly one B-attempt/service payment. OFF recorded no
candidates. Eleven later ON candidate attempts exceeded the predeclared
four-slot observation bank and were not examined.

The [combined validation](../../artifacts/m3b-worker-suspension-validation-01/summary.json)
rehashes 852 identities. Both same-code offline replays passed:
[OFF](../../artifacts/m3b-worker-suspension-inspection-off-01/report.json) and
[ON](../../artifacts/m3b-worker-suspension-inspection-on-01/report.json).
The separate [Python reconstruction](../../artifacts/m3b-worker-suspension-review-02/review.json)
passed 837 identities and reconstructed the guest protocol, native banks,
ownership, transition sequence and service accounting. All new code and reviews
have the same root author; this is separate-language validation, not an external
independent audit.

## Exact suspension boundary

The compiled generated function returns before `m3b_service_after_call` can
call `trysleep`. These episodes therefore validate the suspended **native
dispatcher/service continuation on the owning worker**. They do not establish
the lifetime of an active generated-WASM frame across suspension.

The new native source changes exactly `tcg/wasm64.c` and adds
`tcg/m3s-observer.inc`. It opens an observation only when an actual fused return
has positive debt, the existing countdown equals one, and the ordinary pool
predicate is full. The service helper itself is byte-identical to the original
ABI2 runtime. The 50,000-turn countdown, 12,000-instance cap, guards, GC callbacks
and default-off setting remain unchanged. No sleep, countdown reset, forced
collection, capacity bypass or invalidation action was added.

A separately bound JS derivative wraps six exact generated-glue anchors. It
captures the raw native state getter before export wrapping, records the real
pthread identity after thread initialization, and observes the original four
`handleSleep` transitions. Each original transition is called exactly once;
the observer introduces no yield and preserves its return value or exception.
The actual new native WASM and five other runtime assets are byte-identical in
the derived runtime. Original runtimes and earlier evidence remain unchanged.

All four retained episodes identify guest PC `0x403004`, code `0xa035680`,
descriptor owner `0xa0355c0`, generation `0x158c9` and worker `0x31b5e180`.
They match the independently captured watched sentinel census. Each shows:

- Native states `0→1`, `1→0`, `0→2`, `2→0`, on that owning pthread.
- Debt one before the original service helper and zero during every transition
  and after return; B attempts and service paid each advance by exactly one.
- Identical before/after values for the captured sixteen GPRs, PC, raw lazy-flag
  fields, control registers, mode flags, MXCSR, x87 control/status/tag fields,
  and eight segment-cache records.
- Charge 12,000 before, during and immediately after the observed sleep. Later
  natural collection reduces final charge, without a forced-GC operation.

The raw 128-word state snapshots do not contain complete architectural XSTATE.
Enabled user XSAVE return-state preservation has its own
[accepted evidence](m3b-xstate-preservation-01.md).

## Fixed pressure work

The [fixture](../../tests/m3b-worker-suspension/README.md) has one predeclared
pressure cycle: execute ordinary generated loops until at least 7,000
instances are installed, warm the sentinel eight times, continue until the
first ordinary 6,000-instance retirement, and perform all sixteen revisits.
Each generated loop and sentinel invocation uses 100,000 iterations; generated
nodes are bounded at 12,000 and grouped in batches of 64. The capture deadline
is thirty minutes. There was one OFF capture and one ON capture, with no retry
or early-success termination.

| Observation | OFF | ON |
|---|---:|---:|
| Guest gates | 127 | 126 |
| Generated nodes / arithmetic checks | 6,976 / 7,002 | 6,912 / 6,938 |
| Installations at sentinel warm gate | 7,304 | 7,113 |
| Ordinary instance retirements | 6,000 | 6,000 |
| Fixed sentinel revisits | 16 | 16 |
| Retained completed episodes / native transitions | 0 / 0 | 4 / 16 |
| Further candidate attempts beyond observation bound | 0 | 11 |
| Whole-run compiled / TCI fused entry attempts | 0 / 0 | 2,398,269 / 1,500 |
| Whole-run B attempts / service paid | 0 / 0 | 2,399,066 / 2,399,066 |
| Debt errors / entry rejects / TB flushes | 0 / 0 / 0 | 0 / 0 / 0 |
| Final pool charge / hard cap | 7,322 / 12,000 | 7,157 / 12,000 |

The differing node counts follow the predeclared capacity threshold; these are
not matched-work timing samples. Whole-run ON B-request count is two, but this
alone does not prove precise natural-interrupt recognition or recovery. Counts
are entry attempts, not retired guest bodies or time fractions.

Raw stream chunks and stopped native banks were fsynced before interpretation
and ACK. Python additionally checks that each gate's complete guest serial
record was in its durable prefix before ACK. The builder was stopped before
both captures; owned browser cleanup passed after each.

## Provenance and retained failures

The actual pinned-SDK native build passed all 1,566 steps, followed by full
before/after verification of 10,115 source files and fourteen symlinks. The
actual guest ELF, disassembly, shape probe and SDK invocation passed preflight.
The [fixture source freeze](../../artifacts/m3b-worker-suspension-fixture-source-01/manifest.json)
binds 21 files and 753 dependencies. Host checks passed five tests, fourteen JS
syntax checks and four Python AST checks. The accepted
[reviewer source freeze](../../artifacts/m3b-worker-suspension-review-v2-source-01/manifest.json)
binds five files and six test methods, including deliberate native-state,
transition, identity, protocol and receipt corruption.

The initial post-build verifier compared a symlink map with a list; its
[failed receipt](../../artifacts/m3b-worker-suspension-postbuild-01/failure.json)
is retained. The corrected verifier checks the exact map and resolved internal
targets without changing native source. The first Python replay attempted to
compare byte strings through a JSON-only equality helper; that
[failed review](../../artifacts/m3b-worker-suspension-review-01/review.json)
is also retained. A new frozen reviewer revision checks byte equality directly
and passes the same saved captures. No capture was rerun for either correction.

## Remaining gates

Suspended-owner invalidation, complete intermediate architectural state,
natural interrupts, alias SMC and later-block invalidation remain open. The
existing stopped-only mutation guards were never bypassed. M3b stays default
off and partial. These diagnostic captures establish no end-to-end speedup or
deoptimization under the current uncontrolled host load. The earlier timing
pilot and exactly two requested repetitions remain complete and unchanged;
uninstrumented resource and performance acceptance are still required.

The later [guest-alias SMC evidence](m3b-alias-smc-01.md) closes the scoped
between-call alias case. Active-body later-block SMC remains open.

The later [natural guest signal pair](m3b-natural-signal-01.md) establishes
precise saved integer contexts and resume during positive compiled workloads.
Exact native B-poll attribution and full intermediate XSTATE remain open.
