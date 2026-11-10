# M3b Bun admission and original-runtime confirmation

The unchanged Bun workload now has **positive two-block fusion exposure** in
both the admission-observer runtime and a fresh capture of the original ABI2
runtime. All captures passed 69 gates and 12 expected workload results, with
72 durable observations each. The original zero-exposure pair remains retained
and accepted. The cause of that variation is not established.

The [combined validation](../../artifacts/m3b-bun-admission-validation-01/summary.json)
rehashes 840 identities, including source freezes, their additional dependency
maps, native pre/post-build receipts, raw captures and offline reconstruction.
This is correctness and exposure evidence. **No new speedup, causal regression,
or production promotion is established. M3b remains off by default.**

| Capture | Regions formed | Compiled entry attempts | Warmup compiled attempts | Measured integer compiled attempts | Measured JSON / SHA / HTTP |
|---|---:|---:|---:|---:|---:|
| Original OFF 01 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| Original ON 01 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| Admission observer OFF 01 | 0 | 0 | 0 | 0 | 0 / 0 / 0 |
| Admission observer ON 01 | 2 | 76,731,029 | 1,743,848 | 74,987,181 | 0 / 0 / 0 |
| Original runtime ON 02 | 3 | 76,634,772 | 1,743,819 | 74,890,953 | 0 / 0 / 0 |

The table contains cumulative entry attempts, not retired bodies, time shares,
or per-PC attribution. No census watch, trace, injected recovery, forced GC,
counter reset or workload modification was used. Phase boundaries come from
the original serial protocol. Activity during an integer phase alone does not
identify a particular JSC code generation or application PC.

## Observation-only native change

The new runtime changes exactly two native files: the existing frontend adds
observations around its original short-circuit checks, and a new file holds a
128-word admission bank. The original eligibility function, byte grammar,
RAM guard, service accounting, fallback and budgets remain unchanged. The
bank has no reset or configuration API and is read only while the VM is paused.
Rejection reasons may overlap; stage counts and predecoder results partition
their respective totals. The last byte sample is bounded by the original
RAM-span check and is descriptive, not a census of executed code.

[Host tests](../../artifacts/m3b-admission-host-tests-01/report.json) passed in
plain and ASan/UBSan variants, including 16,384 predicate comparisons with the
verbatim original eligibility function, 1,024 bounded copies next to a protected
page, invalid bounds and saturation. These are host-model tests. The subsequent
actual pinned-SDK native build passed all 1,566 steps. Full before/after source
inventories contain 10,115 files and retain 14 engine links; the
[binding](../../artifacts/m3b-admission-binding-01/binding.json) connects that
two-file overlay, build and seven runtime assets to the original ABI2 binding.

The enabled admission capture observed:

| Stage / result | Count |
|---|---:|
| Translation attempts | 576,668 |
| Rejected by original eligibility predicate | 191,292 |
| Missing host pointer / rejected RAM span | 0 / 0 |
| Reached original predecoder | 385,376 |
| Accepted | 2 |
| Instruction limit / truncated input | 42 / 981 |
| Unsupported opcode / prefix | 141,707 / 13,840 |
| Memory / control / closure rejection | 182,918 / 3,000 / 42,886 |

Eligibility rejection reasons were mode 173,802, blocked hflags 25,876 and
blocked cflags 66. These overlap and must not be summed as disjoint stages.
No context, PC-relative, RAM-page or dynamic-profile rejection occurred in ON.
OFF rejected all 737,651 attempts through the disabled-profile predicate.
These results rule out a universal eligibility or RAM barrier in this ON run;
they do not show what caused the earlier original-runtime zero result.

The diagnostic [OFF](../../artifacts/m3b-bun-admission-off-01/report.json) and
[ON](../../artifacts/m3b-bun-admission-on-01/report.json) captures passed the
frozen JavaScript inspectors and a
[separate Python reconstruction](../../artifacts/m3b-bun-admission-review-01/review.json)
of 776 identities. All were authored by the same root agent; this is a separate
implementation of the oracle, not an externally independent source audit.
The frozen harness passed 33 Node tests, ten syntax checks and a controller
AST check. The Python reviewer passed seven test methods including 13
corruption subtests and four AST checks.

## Original-runtime confirmation

Positive exposure might have depended on the added observer. A
[plan retained before launch](../../artifacts/m3b-original-confirmation-plan-01/plan.json)
therefore declared exactly one fresh ON capture using the original ABI2 runtime
and original frozen exposure harness. It required retaining either zero or
positive exposure, without retry or best-result selection. Only the controller's
fixed ON selection and fresh output paths differ from the original controller.

The [capture](../../artifacts/m3b-bun-exposure-on-02/report.json) passed, with
three formed regions and the positive counts in the table. Its
[JavaScript replay](../../artifacts/m3b-bun-exposure-inspection-on-02/review.json)
and [Python reconstruction](../../artifacts/m3b-original-confirmation-review-01/review.json)
also passed; the latter checks 730 identities and exact serial bytes, including
CRLF. The admission observer is therefore not required for positive exposure.
This is not a controlled explanation of the earlier zero result, nor an
estimate of how frequently a fresh guest will expose fusion.

## Scope and next gates

All runs use the same original guest package, application, kernel and workload
parameters, with cold continuation, one CPU, private 512 MiB RAM, 128 MiB TB
buffer and the unchanged 12,000-instance hard cap. Migration is prohibited by
the diagnostic machine guard: no snapshot capture or restore was attempted.
Every observation was durably written before its guest ACK. Separate owned
browser cleanup audits passed, and the native builder was stopped after build.

Whole-run B attempts equal service paid: 76,742,534 with the observer and
76,742,389 in the original-runtime confirmation. Debt errors and entry rejects
are zero. B-request observations were seven and one respectively, with injection
controls disarmed. They do not identify the requesting event or establish full
natural-interrupt state correctness. Global TCI target returns are not counts
of completed guest bodies. Pool charges remained below the fixed cap; cumulative
emission and reserved linear-memory sizes are not resident-memory measurements.

Host load remains uncontrolled, and these diagnostic captures are not timing
eligible. They are not additional repetitions of the already completed timing
pilot. Controller wall times must not be used to infer a gain or deoptimization.

Remaining M3b gates are complete required architectural state, natural
interrupt/alias-SMC behavior, owning-worker Asyncify continuation with
suspended-owner invalidation, exact current code/PC attribution and exposure
variability, and uninstrumented resource/performance acceptance. The next
correctness work should exercise those boundaries with exact state evidence.
The default-off candidate has not completed the M3b exit gate or the full plan.

Follow-up: the [extended-state fixture](m3b-xstate-preservation-01.md) subsequently
passed fresh OFF/ON runs with seeded preservation of every enabled user XSAVE
component in the observed x87/SSE/YMM/MPX profile. Complete state at intermediate
boundaries, suspension, invalidation and performance gates remain open.

Follow-up: [current-run code attribution](m3b-code-attribution-01.md) subsequently
bound exact formation bytes, descriptor generations and per-phase tier attempts
in one fresh unchanged-Bun pair. It does not resolve the earlier zero exposure
or establish a timing improvement.
