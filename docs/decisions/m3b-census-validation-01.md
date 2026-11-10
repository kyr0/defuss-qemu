# M3b census validation evidence — 2026-11-07

Evidence snapshot after the complete v5 OFF/ON pair and independent replay.
M3b remains disabled by default. These artifacts are diagnostic
(`timingEligible: false`); they establish no performance or promotion result.

The ABI2 census observes actual watched entry attempts across compiled and
TCI dispatch, including hidden chains and generic entry refusals. Its segment
identity compares selector, full base, decoded limit and access flags masked
by `0x00f0ff00` (G/B/L/AVL/P/DPL/S/TYPE). QEMU descriptor loads retain redundant
base/limit encoding in the raw flags word, while SYSRET can synthesize an
equivalent cache. ABI2 retains all eight raw segment flags in tuple90..97,
excludes only those copies from semantic continuity, and preserves every
other context/owner/generation check. The observed representation change does
not identify the particular kernel return instruction. See the
[source rationale](../../experiments/m3b-context-census-v2/SEGMENT-FLAGS.md)
and [independent ABI1 failure diagnosis](../../artifacts/m3b-context-off-failure-review-01/review.json).

The extracted native adapter, dispatch and typed-injection contracts passed
[ASan/UBSan host checks](../../artifacts/m3b-context-census-v2-host-tests-01/report.json).
The actual [SDK build](../../artifacts/m3b-context-v2-build-01/build-report.json)
and [full post-build source/runtime recheck](../../artifacts/m3b-context-v2-build-review-01/review.json)
passed. The [ABI2 runtime binding](../../artifacts/m3b-context-v2-binding-01/binding.json)
pins source fingerprint
`46499e15df66b2f8d363d35846812bf99685ac2da44727d54494890e459ea321`
and the exact runtime files. Host sanitizer success alone is not guest validation.

The actual [v4 OFF capture](../../artifacts/m3b-context-v4-off-01/report.json)
passed all45 unchanged guest gates and PASS:11 programs,943364 checks,
digest `2f5b81ae5cb6964b`, final state paused. This is one control capture,
not an accepted enabled/disabled pair.

The following retained captures remain failed; later source corrections do
not change their status.

| Capture | Retained reason and evidence |
| --- | --- |
| ABI1 OFF, gate5 | Sticky census faults24. CS/SS raw flags differed only by `0x000f0000`, although decoded limits and all other tuple words agreed. [Review](../../artifacts/m3b-context-off-failure-review-01/review.json). |
| ABI2 host-v2 OFF, gate41 | A complete71,543,108-byte stopped window exceeded the fixed64MiB parser limit; census fault0. [Review](../../artifacts/m3b-context-v2-off-failure-review-01/review.json). |
| Host-v3 OFF, complete | All45 gates/PASS were retained, but the zero-tail rule rejected one43-byte unfiltered native `Linking TBs` line. [Review](../../artifacts/m3b-context-v3-off-failure-review-01/review.json). |
| Host-v4 ON, gate3 | The global `tciTargetReturns` delta was1, contrary to the frozen zero rule. Fused TCI entries and backedge returns were0; no ACK3, later gates or PASS followed. [Review](../../artifacts/m3b-context-v4-on-failure-review-01/review.json). |

The last review independently calculated **F495 + R55 + D0 =550** for the
closed failed gate: fused B-boundary attempts plus certified ordinary RF
A-to-B continuations plus initial direct-B routes. Service count was495;
all63 RF A attempts and54 hidden normal attempts were accounted for. These
are source-defined routes and attempted entries, not general instruction
retirement counters. The global TCI target-return counter records a return
to the outer fused guard before target admission/execution; it adds no body
or service term. This diagnostic calculation is not a retroactive pass.

The new24-file v5 source set records that global monotonic handoff delta
separately while preserving selected-tier, census/context, RF/body/service,
all45 guest-oracle and bounded terminal-tail checks. Its
[73 host tests and21 syntax checks](../../artifacts/m3b-context-v5-host-tests-01/report.json)
and [independent source review](../../artifacts/m3b-context-v5-source-review-01/review.json)
passed. The actual [v5 OFF](../../artifacts/m3b-context-v5-off-01/report.json)
and [v5 ON](../../artifacts/m3b-context-v5-on-01/report.json) captures each passed
all 45 gates and 943,364 checks with digest `2f5b81ae5cb6964b`, zero census
faults and final paused state. Both owned-browser cleanup audits passed.
All 12 positive ON windows satisfied the unchanged guest and logical route
conservation checks; no elapsed-time performance conclusion is drawn.

The first OFF offline replay failed only its generic 128 MiB dependency-read
bound on already hash-bound historical traces. That attempt remains preserved.
A separately frozen and [reviewed inspector](../../artifacts/m3b-context-inspection-v6-source-review-01/review.json)
allows only canonical historical `native-trace.log` dependencies with exact
SHA256/byte identities up to 512 MiB. All semantic replay code, explicit
metadata bounds and 128 MiB parsed-window bounds remain unchanged. The new
[OFF replay](../../artifacts/m3b-context-v5-inspection-off-02/report.json) and
[ON replay](../../artifacts/m3b-context-v5-inspection-on-01/report.json) passed.
The separate frozen Python [independent baseline review](../../artifacts/m3b-context-v2-baseline-review-01/review.json)
then passed, rechecking 1,111 file identities and independently recomputing
raw census, trace, guest, service and route results. Its SHA256 is
`8a57a079a6566deed0724fb3164d76beb7517df2b23e6297c9d4b312f39f30ce`.
The baseline result does not retroactively accept any earlier failed capture.

The fresh [typed-recovery OFF](../../artifacts/m3b-context-recovery-v2-off-01/report.json)
and [ON](../../artifacts/m3b-context-recovery-v2-on-01/report.json) captures and
same-code offline replays passed all 45 gates and 943,364 checks per arm.
The [independent recovery replay02](../../artifacts/m3b-context-recovery-v2-review-02/review.json)
passed 1,392 identities, SHA256
`787daacb8be1e6874893e740013b11f362df686a891ff0faa276d5b830d20dd0`.

The generation-specific native API was called exactly once for each deliberate
mutation, while paused and before watch reset/ACK. The stale-instance action
caused exactly one stale miss and resumed compiled execution under the same
owner generation. The invalid-descriptor action caused exactly one certified
early rejection, then selected a newer generation. That fresh generation had
**1,228 TCI and zero compiled entries** across the three measured recovery
windows; this result does not claim fresh-generation recompilation. All 12
positive ON windows retained their exact guest, RF/body and service equations.

The first independent recovery review failed an output-representation comparison:
Python's stop object used integer PC/pointer fields and omitted the raw line
number. Its [retained diagnosis](../../artifacts/m3b-context-recovery-review-representation-diagnosis-01/review.json)
binds the original bytes. A separately frozen and reviewed verifier revision
reconstructs and checks all six fields from those bytes; its four core proof
modules are unchanged and 21 synthetic checks passed. Review01 remains failed;
review02 supplies the accepted complete replay. No guest capture was rerun or
rewritten for this correction.

The separate [pressure OFF](../../artifacts/m3b-fused-pressure-off-01/report.json)
and [pressure ON](../../artifacts/m3b-fused-pressure-on-01/report.json) captures
passed 112 gates, 6,987 guest checks and 6,976 generated churn nodes per arm.
Both completed on the first of at most 16 allowed revisits. The
[independent pressure replay](../../artifacts/m3b-fused-pressure-review-01/review.json)
passed 1,300 identities; its SHA256 is
`fe2b69ab56e48a9b1464b4fa9170d43c3efbe2d3f447882a9e61a1ffa68b7e76`.

| Evidence | OFF control | ON fused owner |
| --- | ---: | ---: |
| Warm cumulative installations, before any retirement | 4,585 | 4,546 |
| First observed FIFO retirement | 6,000 | 6,000 |
| Cumulative installations at accepted revisit | 12,685 | 12,641 |
| Charged instances at accepted revisit; hard cap 12,000 | 6,685 | 6,641 |
| Added normal compiled entry attempts after retirement | 100,000 | 99,982 |
| Global TB flushes after warmup | 0 | 0 |

The warm sentinel is within the first 6,000 FIFO positions. Its cumulative
watch banks stay unchanged through churn, then the same descriptor generation,
code pointer, physical page and semantic context reenter the compiled tier.
In ON, ordinary RF compiled entries cannot substitute for fused reentry.
The unchanged source releases charged capacity only after natural GC callbacks;
retirement itself retains the charge. Neither the global installation increase
nor collection timing is attributed to one particular sentinel callback.

This lifetime result is explicitly scoped to the diagnostic **256 MiB translation
buffer**, one CPU, 512 MiB guest RAM and the unchanged 12,000-instance hard cap.
It does not establish production 128 MiB capacity, suspended-function safety,
natural interrupt state, active alias-SMC recovery, full XSTATE or speedup.
M3b remains off by default.

The [combined validation record](../../artifacts/m3b-census-validation-01/summary.json)
binds all three accepted reviews to the same runtime and verifies that each
outcome used its exact frozen reviewer sources. Remaining M3b release gates
include complete architectural state, owning-worker suspension, natural
interrupt/alias-SMC behavior and uninstrumented
resource/performance confirmation. A subsequent
[unchanged-Bun cold pair](m3b-bun-exposure-01.md) passed all workload checks but
recorded zero fusion formation/execution in the enabled runtime. A later
[admission diagnostic and original-runtime confirmation](m3b-bun-admission-01.md)
passed with positive Bun fusion exposure in warmup and integer phases, retaining
the unexplained earlier zero result. Exact current code attribution remains
open. These results do not complete all of PLAN.md.
