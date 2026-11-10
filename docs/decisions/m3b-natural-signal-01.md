# M3b natural guest signal contexts and resume

The revised OFF/ON pair passed ten gates, one warm call and **eight actual
single-shot virtual CPU timer signals per arm**. All sixteen saved GPRs, the
interrupted instruction boundary and exact saved flags matched the arithmetic
reference. After ordinary signal return, every call produced the correct full
integer state. Each call also had positive compiled exposure at the watched PC.

The [combined validation](../../artifacts/m3b-natural-signal-v2-validation-01/summary.json)
passed 838 identities. Both frozen JS offline inspections passed; the separate
[Python reconstruction](../../artifacts/m3b-natural-signal-v2-review-01/review.json)
passed 781 identities, including raw guest bytes already durable before every
ACK. All new code and reviews have the same root author; this is separate-language
validation, not an external independent audit.

## Natural delivery and precise state

The unchanged original ABI2 runtime executes the seventeen-byte ADD sentinel
at RX `0x20000000`, with A at `0x20000004` and B at `0x20000009`. The guest warms
it for 100,000 iterations, then performs eight fixed calls of
`1,000,000 + 1,009*i` iterations with distinct step values and seeded registers.
Each call arms one `ITIMER_VIRTUAL` timer for 10 ms of guest user CPU time.
No native interrupt, boundary selector, added sleep, countdown reset or
invalidation action is used.

The Linux `SIGVTALRM` handler runs on a separate 64 KiB signal stack and copies
the actual ucontext into one bounded slot. Every case has exactly one signal,
number 26, `SI_KERNEL` code 128 and errno zero. The handler does not modify the
saved context. Missing, duplicate or outside-loop delivery fails the fixture.

The oracle reconstructs accumulator/counter progress at each possible decoded
instruction boundary, including the difference between state before and after
ADD. It independently calculates carry, parity, auxiliary carry, zero, sign
and overflow. All preserved registers and the active stack are checked. The
final sixteen GPRs and RFLAGS `0x246` are verified after normal sigreturn.

| Observation | OFF | ON |
|---|---:|---:|
| Calls / natural signals / saved contexts | 9 / 8 / 8 | 9 / 8 / 8 |
| Observed signal PCs at A / B | 6 / 2 | 8 / 0 |
| Watched compiled / TCI entry attempts | 8,126,752 / 1,500 | 8,126,152 / 1,500 |
| Fused B attempts / service paid | 0 / 0 | 8,125,339 / 8,125,339 |
| Natural B-request count | 0 | 0 |
| Fused entry rejects / debt errors / TB flushes | 0 / 0 / 0 | 0 / 0 / 0 |
| Final pool charge / hard cap | 5,164 / 12,000 | 5,196 / 12,000 |

ON uses one warmed fused generation `0x13c1d`, descriptor `0x9717e00`, code
`0x9717ec0`, physical page `0x127e2`. OFF uses ordinary generation `0x13b82`
on its own page `0x1c7e2`. Owner, generation, code and physical page stay stable
through all calls within each arm. Native entry counts are attempts, not retired
bodies or elapsed-time fractions.

The eight ON signals all preserve state at A. **No natural private B-poll
request was recorded.** These captures therefore prove natural guest integer
contexts and resume in a workload with compiled fusion, without attributing
any particular delivery to a compiled versus TCI dispatch or to the B poll.
They do not establish FP/XSTATE at the signal boundary or complete native,
kernel or supervisor state. Those distinctions remain explicit.

## Saved RF expectation and retained first failure

The first frozen OFF capture stopped after its first signal: saved flags
`0x10206` differed from the oracle's `0x206` by the Resume Flag. Saved GPRs,
arithmetic progress and full final resumed state matched. The
[failed-capture decision](../../artifacts/m3b-natural-signal-off-failure-01/decision.json)
retains that capture and its source-bound replay. No first-revision ON run was
attempted.

The actual pinned QEMU `do_interrupt64` path sets RF in the saved flags for
these non-software interrupt vectors. The [V2 revision](../../experiments/m3b-natural-signal/V2.md)
requires the exact reference flags **OR `0x10000`**, with no masked bits or
optional RF acceptance. Final resumed flags still require RF clear. The native
interrupt and RF-clear source identities are bound in the fixture freeze.
This validates compatibility with that pinned baseline path, not an independent
proof of hardware RF semantics.

The V2 guest was rebuilt because its C validation changed too. The fixed code
template, timer and work remain unchanged. Seven host test methods, thirteen
JS syntax checks and four Python AST checks passed. The separate four-file
Python reviewer passed six methods with flag, register, signal, owner, service
and protocol corruption. Twenty fixture files and 703 dependencies are frozen.
There was one fresh V2 OFF/ON pair, thirty-minute capture deadlines, verified
stopped builder state and successful owned-browser cleanup.

M3b remains partial and default off. Exact natural B-boundary attribution,
complete intermediate state, active-body later-block SMC, suspended-owner
invalidation and resource/performance acceptance remain open. These diagnostic
runs establish no speedup or deoptimization under uncontrolled host load. The
earlier timing pilot and exactly two requested repetitions remain complete.

Follow-up: the [interrupted-call alias pair](m3b-signal-alias-01.md) subsequently
combined natural guest signal contexts with handler writes to the later loop
block. Exact mixed-operation results and nine compiled replacement generations
passed; active generated-frame and Asyncify-suspended-owner mutation remain
outside that scope.
