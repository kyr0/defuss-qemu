# Prospective finite-horizon comparison of passive FIFO retirement

Status: proposed measurement design, 7 November 2026. This document authorizes
no benchmark result, candidate promotion or harness change. Candidate code,
correctness evidence, an executable machine-readable plan and a source freeze
must precede a new pilot. No guest, build or measurement was run to prepare it.

The hypothesis is that the separately specified
[passive-fifo-v1 policy](passive-fifo-retirement-design-01.md) reduces completion
time for a fixed full-system workload by at least 5%, while meeting the retained
regression, resource and service budgets. The estimand is **finite workload
completion latency**, including initialization and control overhead. It is not
steady-state throughput, a plateau, exclusive CPU time, native parity or an
unbounded service-latency claim.

## Why this is a separate experiment

The [sustained-v2 exploration](../../artifacts/m2-sustained-v2-exploration-analysis-01/analysis.json)
failed selection: its SHA ratio was approximately 0.98075, its predeclared drift
condition failed, and its approximate confirmation requirement was 344 pairs,
above its 32-pair cap. Those decisions remain unchanged. The
[independent pool audit](../../artifacts/m2-sustained-pool-audit-01/review.json)
and [full descriptive replay](../../artifacts/m2-sustained-v2-pool-diagnosis-01/review.json)
found a charged-cap/release cycle in all eight VMs, alongside large integer and
JSON intervals. They motivate a new lifecycle hypothesis; they do not establish
that retirement exclusively caused the delays or that MSG2 was beneficial.

A repeatable transition within a specified workload is part of its completion
cost. Requiring every control endpoint to look stationary would exclude the
very behavior this new policy targets. The new experiment therefore preserves
drift as a diagnostic and measures the complete finite horizon. This change of
question is prospective: no sustained-v2 report is relabeled, reaggregated into
the new pilot, used to estimate its uncertainty, or included in confirmation.
The new policy and protocol require new identities and wholly fresh captures.

## Fixed comparison and admission prerequisites

The initial comparison is Chrome, x86-64 full-system execution, one vCPU,
512 MiB guest RAM, 128 MiB TB allocation, hot limit 1500 and runtime flags 3.
The charged-instance hard cap remains 12000. Plan/AOT, M3 selection and MSG2
are off in both arms. The two packages select only the independent, immutable
pre-vCPU passive-policy choice, default off. Their compatibility identities
must differ so that restore state cannot cross modes. Both arms use the same
uninstrumented runtime JS/WASM artifact. Off mode must reproduce the legacy
pool policy in actual execution before comparing its timing.

The first candidate is fixed at soft threshold 9000, FIFO retirement batch
256, at least 512 live records and at least 256 successful installations
(including reinstantiations)
between soft batches. It consumes only completed callbacks, retains charges on
unlink, refuses a further soft episode while pending is positive, and adds no
sleep, yield, timer, GC request or dispatcher countdown. Existing pressure
admission and the emergency full-cap half-ring/TCI path remain unchanged.
Unsupported profiles use the legacy policy. These constants are a hypothesis,
not observed optima; changing them creates a new candidate and pilot.

Before the pilot, fresh source-bound correctness and separate diagnostic runs
must verify the policy contract, selected-path exposure, exact accounting,
natural retirement/reinstantiation and forced fallback. Required architectural
coverage includes state/flags/SIMD, faults, SMC, interrupts and continuation;
maintenance-adjacent unwind/rewind must not duplicate retirement or callback
consumption. A held-out workload is required. Instrumentation is absent from
timing. An unresolved safety/accounting failure blocks timing; a diagnostic
failure is not reclassified as an absence of statistical significance.

## One fixed workload, with every interval charged

Keep the original operation source, input sizes and expected results:
250000 integer iterations; JSON 128 records and 8 rounds; SHA256 65536 bytes
and 16 rounds; loopback HTTP 8 requests. Each batch makes 100 calls.
There are five prelude rounds and eight subsequent rounds per endpoint:
**20 nominal warmup batches plus 32 measured batches, 5200 calls in each VM**.
The word “warmup” identifies protocol position; it excludes no elapsed cost.

Keep the existing balanced four-endpoint order cycle:

1. integer, JSON, HTTP, SHA256
2. JSON, SHA256, integer, HTTP
3. SHA256, HTTP, JSON, integer
4. HTTP, integer, SHA256, JSON

The prelude uses the cycle followed by its first order; the subsequent rounds
repeat the cycle twice. No extra rounds, shortened horizon, per-run warmup
extension, selected suffix or adaptive stop is allowed. Keep all 20 empty
calibration gate pairs and the same per-phase stop/ACK protocol. This fixes
148 gates and 149 COM1 signals, including the capture-ready signal. Every
operation result, phase identity and gate must validate.

All timestamps use one browser monotonic clock. The prospective harness must
explicitly record `t0` immediately before invoking the VM/app startup path,
before VM asset reads or factory initialization, and `t1` when the complete
gate's confirmed stop, result validation and stopped reads have finished,
before its final ACK. The existing meaning of phase timestamps is retained.
Do not reconstruct `t0` from guest time, subtract initialization or use an
uncalibrated Node/browser clock difference.

| Quantity | Exact definition and role |
| --- | --- |
| Full horizon `H` | `t1 - t0`; primary. Includes runtime/assets, boot, fresh capture and durable snapshot ACK, initialization, calibration, all 52 batches and every intervening stop/read/ACK/scheduling gap. Browser-process launch before the browser task and cleanup after `t1` are outside the claim and recorded separately. |
| Phase interval `P_i` | Result-record arrival minus immediately-before-start-ACK timestamp, for each of the 52 batches. Includes ACK delivery/wakeup, guest work and serial result framing. |
| All-phase sum `S` | Sum of all 52 `P_i`, including all 20 prelude batches; regression guard. No medians, trimming, empty-gate subtraction or clock correction. |
| Workload total `S_k` | Sum of its 13 batch intervals, 1300 calls, for each of integer/JSON/SHA256/HTTP; four regression guards. |
| Prelude/subsequent splits | Per-workload and overall sums for the 20 and 32 batches, respectively; descriptive partitions of `S`, never alternative primary endpoints. |
| Outside-phase cost `G` | `H - S`, with exact chronological partition below. Contains real initialization/control/gap cost; retained, never subtracted from `H`. |

For audit, order the 52 intervals by their raw start/end timestamps and require
them to be non-overlapping inside `[t0,t1]`. Partition `G` into the prefix from
`t0` to the first batch start, every end-to-next-start gap, and the suffix from
the last result to `t1`. Require all components nonnegative and reconstruct
`H = prefix + sum(P_i) + sum(gaps) + suffix` within the specified clock-rounding
tolerance. Store each component and relevant gate timestamps. Calibration,
maps, stops, reads and scheduler delays remain visible within these intervals.
Thus a policy cannot obtain an apparent improvement by moving work into the
prelude, startup, or ACK gaps that an endpoint silently omits. Changing the
start/end convention requires a new protocol identity before collection.

Fresh capture is the sole initial sample type. Restore has a distinct question
and is not substituted for a capture. No counter, code-capture or resource
observer instrumentation enters these timing records. Any required stopped
pool/linear-memory observation is identical in both arms and its overhead is
included in `H`.

## Frozen statistical and resource gates

Every ratio is candidate/control. An independent observation is a fresh pair
of VMs; 52 batches inside one VM are dependent observations. Form each VM's
totals first, then pair them. Report paired ratios and their geometric mean.
Confirmation resamples whole pairs, using the same paired indices across all
endpoints, with 50000 draws and seed 20261107. The executable plan must pin the
PRNG and quantile convention and have an independent numerical replay.

| Gate | Retained numeric budget | Confirmation bound |
| --- | --- | --- |
| Primary full horizon `H` | At least 5% lower time | Upper bound strictly below 0.95; upper endpoint of a two-sided 99% paired interval, equivalent upper-tail level 99.5%. |
| `S` and four `S_k` totals | Less than 10% regression | Each one-sided upper bound strictly below 1.10. Bonferroni across these **five** guards gives family 99%, hence 99.8% for each bound. |
| Capture readiness | Less than 10% regression | One-sided 99% upper bound below 1.10; readiness includes the durable capture cost as before. |
| Service proxies | Less than 50% regression | Empty-gate nearest-rank p95 of the 20 calibration intervals, and maximum result-to-confirmed-stop tail over **all 52** workload batches. Each one-sided 99.5% upper bound below 1.50, family 99% over the two proxies. |
| Observed linear memory | At most 10% growth | Maximum retained stopped observation per VM; every paired ratio at most 1.10. This is not host peak memory. |
| Generated module input bytes | At most 10% growth | Separate matched diagnostic full-horizon captures, cumulative successful module-input bytes from startup through complete; candidate/control at most 1.10. Preserve attempts/successes, maxima, initial/phase/gap/tail partitions and repeated-instantiation scope. |
| Runtime artifact identity | Exactly matched timing arms | Identical JS/WASM bytes in off/on packages (ratio 1.00). Also report absolute bytes and change from the retained production artifact; matching arms alone does not establish zero implementation footprint. |

The confidence levels above retain the prior treatment of primary, readiness
and service endpoints, while expanding the workload-regression family from
three to five members. They are explicit family-specific guarantees, **not a
claim of simultaneous 99% coverage across every reported quantity**. Passing
the decision requires all gates; none can substitute for another. Prelude
splits, gaps, drift, guest-clock quotients and per-batch plots are descriptive,
not extra opportunities to select a favorable endpoint.

The 1.10 memory/code budgets remain prerequisites for promotion. The timing
runtime's stopped linear-memory observations and cumulative module-input-byte
diagnostics do not measure native JIT resident bytes, true host peak memory,
or long-run growth. These missing measurements remain explicit open gates;
they cannot be declared passed because a finite workload finishes or the
charged cap holds. Service proxies likewise do not establish a worst-case
interrupt or external-network latency bound. A later instrumented resource
run cannot contribute a timing observation.

## Fresh pilot, planning and confirmation

Collect one fixed exploratory pilot of four fresh pairs, ordered AB, BA, AB,
BA (A=legacy off, B=passive on). It is not confirmation. Retain every completed
capture and all its intervals. Pilot selection requires primary point ratio
below 0.95 and every workload/readiness/service point ratio within its stated
budget, together with correctness and observed resource gates. No pilot
confidence interval alone establishes improvement. Drift is reported for
each endpoint, along with pool/count trajectories, but is neither an exclusion
nor a plateau requirement for this finite-horizon estimand.

Use only these four new paired log-ratios to plan fresh confirmation. For each
statistical gate `j`, let `s_j` be the pilot sample standard deviation of its
four log-ratios. Use the fixed conservative design standard deviation
`s_design,j = s_j * sqrt(3 / chi2(0.10,3))`, with
`chi2(0.10,3) = 0.5843743741551835`. The predeclared power target is 80%.
The design alternative is ratio 0.90 for the primary (limit 0.95), and ratio
1.00 for every regression/readiness/service endpoint (limits 1.10 or 1.50).
Use the endpoint's specified upper-tail normal quantile `z_j`:
`z(.995)` primary/service, `z(.998)` for each of five workload guards, and
`z(.99)` readiness. Let `z(.8)` be the power quantile and calculate

```text
N_j = ceil(((z_j + z(.8)) * s_design,j / log(limit_j / target_j))^2)
N   = max(8, all N_j), rounded upward to the next even integer.
```

The feasible maximum is fixed at 32 pairs before the pilot. Never clamp a
larger estimate to 32, relax a margin, discard a volatile endpoint or reuse
pilot observations to meet the requested count. Failure of selection or a
calculated count above 32 means no confirmation under this plan. A larger
budget, changed policy or expanded pilot requires a new explicit prospective
design before collecting more data. A zero pilot SD still gives the minimum
eight pairs; invalid/nonfinite planning inputs fail closed.

This is conservative approximate Gaussian planning, not a power guarantee for
the finite-sample bootstrap or for jointly passing all gates. Report every
endpoint's variance, design SD and required count. Freeze the chosen feasible
count, all artifacts and analysis before the first confirmation VM. Confirmation
uses entirely new fresh pairs, alternating AB/BA to the frozen even count, and
retains all observations. No optional stopping or early declaration of success.

## Isolation, failures and interpretation

Keep the hash-bound `limactl` executable, `LIMA_HOME`, builder identity and
12 GiB compiler-VM configuration from the stopped-builder host condition.
Require `Stopped` before and after every fresh timing capture. Run owned builds,
packaging, diagnostics and measured VMs serially. Record browser/host versions,
load, compressor/swap snapshots and all known interference; do not terminate
unrelated user work or silently drop an inconvenient slow run. Before/after
checks alone do not prove that the compiler VM never started between them;
the owned-work serialization rule remains necessary.

Distinguish a proven pre-`t0` launch failure from any run that has begun. **Any
post-`t0` timeout, guest/browser failure, lost required evidence or later host
condition/protocol/hash/validation failure permanently invalidates acceptance
for the whole campaign.** Retain the observation or partial record and halt;
never replace it to accumulate four successful pilot pairs or the frozen
confirmation count. This is stricter than the earlier completed-capture rule.
Crash-resume may execute unstarted steps or retry a failure proved to have
preceded `t0`; if whether `t0` occurred is unknown, fail closed. Never infer
successful completion or permission to retry from missing output.

After confirmation, independently replay raw serial/gates, interval partitions,
hashes, pair order, aggregation, intervals and the frozen planning decision.
The permitted claim, if all timing gates pass, is lower completion latency for
this exact finite workload on the stated profile. Held-out application work,
broader frontend/legacy regressions, native memory and long-run bounds, plus
the policy's lifetime/suspension gates, still control product promotion.

No measurement result exists under this design. The MSG2 screen, sustained
exploration and separate byte-budget evidence keep their original identities,
decisions and limitations.
