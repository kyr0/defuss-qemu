# M3b unchanged Bun: correct results, zero fusion exposure

Historical result for this frozen pair. The subsequent
[admission diagnostic and original-runtime confirmation](m3b-bun-admission-01.md)
recorded positive fusion in warmup and integer phases with both runtimes.
The earlier zero observation below remains valid; its cause is unresolved.

Status: completed diagnostic OFF/ON pair, 7 November 2026. Both fresh guests
passed the original 69 gates and 12 workload results. **The enabled candidate
formed and executed zero two-block regions throughout the entire run.** Every
warmup and measured integer, JSON, SHA and HTTP window also had zero fusion
activity. Positive application exposure and performance acceptance remain open.

The [Python reconstruction](../../artifacts/m3b-bun-exposure-review-01/review.json)
passed and checked 729 file identities. It separately reconstructs raw serial
events, workload answers, counter partitions and phase deltas. It was written
by the same agent as the harness, so this is a separate implementation check,
not an externally authored source audit. Both same-code offline inspections
also passed: [OFF](../../artifacts/m3b-bun-exposure-inspection-off-01/review.json)
and [ON](../../artifacts/m3b-bun-exposure-inspection-on-01/review.json).

| Observation | OFF | ON |
| --- | ---: | ---: |
| Original gates / workload results | 69 / 12 | 69 / 12 |
| M3b predecoder successes / regions formed | 0 / 0 | 0 / 0 |
| M3b compiled / TCI entry attempts | 0 / 0 | 0 / 0 |
| M3b B-boundary attempts / service paid | 0 / 0 | 0 / 0 |
| M3a selected compiled entry attempts, whole run | 1,017,602,502 | 983,583,185 |
| Final charged instances; unchanged hard limit 12,000 | 11,842 | 11,844 |
| Whole-run TB flushes | 7 | 7 |

The M3a counts establish substantial execution through the diagnostic runtime.
They do not identify exclusive CPU costs, retired instructions, application PCs
or a performance difference. Both arms used massive uncontrolled host load.
All elapsed times remain ineligible for speedup or deoptimization claims.
The pool observations and cumulative emitted-byte counters do not establish
resident memory usage or an improvement in memory consumption.

## Exact scope and retained evidence

The [harness](../../benchmarks/harness/m3b-exposure/README.md) uses the already
bound ABI2 native runtime and the original M1 guest bundle, kernel, ROMs and
initramfs. Bundle SHA256 is
`31d28add91e5a78aee775e57a365828f2b75843fc9bbd26b66bfe06e9d4717d5`;
initramfs SHA256 is
`d54f7ed772e0249f6e6d52c7d795a9cd566a378555dbc7f7961aed830b3bd2c6`.
The native binding SHA256 is
`fde6abcfa0cae40e8be1fed679f4e54783325ad16d8d88b9a9a0a517e35c4c22`.

Configuration is one CPU, private 512 MiB RAM, 128 MiB translation buffer,
hot limit 1500 and runtime flags 3. The guarded machine disables ACPI, HPET,
USB and VAPIC; its exact native graph and object contract is checked before
starting the vCPU. There are no watches, resets, fault injections, trace
logging, forced GC or accelerator combinations.

Each fresh run had a 30-minute operational deadline. These were correctness
and exposure runs, not additional repetitions of the completed timing pilot.
The guarded profile forbids migration. The unchanged guest's ready message
receives its cold `C` continuation after a durable paused observation, without
capturing or restoring a snapshot. This is not the production snapshot protocol.

Both captures retain 72 fsynced observations: startup, readiness, 69 gates and
final pause. Each includes original serial text and raw M3a, M3b, boundary and
census banks before the next ACK can be authorized. Inputs are checked before
and after execution, served bytes are restricted to the bound inventory, and
each capture archives its harness sources. The exact captures are
[OFF](../../artifacts/m3b-bun-exposure-off-01/report.json) and
[ON](../../artifacts/m3b-bun-exposure-on-01/report.json). Both ended paused;
separate [OFF](../../artifacts/m3b-bun-exposure-execution-off-01/browser-cleanup.json)
and [ON](../../artifacts/m3b-bun-exposure-execution-on-01/browser-cleanup.json)
cleanup audits found no Chrome processes belonging to their scratch directories.

The frozen harness passed
[17 host tests and seven syntax checks](../../artifacts/m3b-bun-exposure-host-tests-02/report.json).
The final Python reviewer passed
[four test methods including 13 corruption subtests](../../artifacts/m3b-bun-exposure-review-tests-03/report.json).
Its earlier test failures are preserved: an incorrect expectation for the
locked M3a configuration word, then Python's newline conversion when reading
the raw CRLF serial stream. The fixes enforce the actual locked state and
exact original bytes; neither guest was recaptured or changed.

## Admission diagnosis and next gate

A separate [host probe](../../artifacts/m3b-bun-historical-predecode-01/report.json)
ran the exact historical 40-byte integer loop from all six retained M1
phase-end observations through the unchanged predecoder. All six were accepted
in both plain and ASan/UBSan executions, as nine instructions with A length 31
and B length 9. Both truncated-closure controls were rejected. These are twelve
executions of six historical observations with the same body bytes; they are
not twelve independent guest samples.

This rules out a missing byte-encoding rule for that historical loop. It does
not prove the new guests generated the same bytes, mappings, TB starts or mode
flags. The zero predecoder-success counter alone cannot distinguish an earlier
profile/mapping/mode rejection from a different current code shape. The next
implementation step is bounded admission-reason and current-code evidence,
preserving every existing eligibility guard, before changing admission or
running a performance campaign. A measured fusion gain requires actual exposure.

Full XSTATE, natural interrupt and alias-SMC behavior, owning-worker suspension,
and uninstrumented resource/performance confirmation remain open. The candidate
stays off by default and this result does not complete M3b or the overall plan.
