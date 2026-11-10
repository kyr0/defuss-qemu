# Implementation status

The architectural design is in [PLAN.md](../PLAN.md). This file distinguishes
implemented components from milestone exit gates. Retained production runtimes
and the original workload remain the comparison baseline.

| Gate | Current implementation |
| --- | --- |
| M0 | Complete: pruned source import, clean three-target build, retained runtime identities, guest/snapshot validation and portable browser E2E. See [consolidation](CONSOLIDATION.md) and [E2E validation](../e2e/VALIDATION.md). |
| M1 | Corrected PC/edge diagnostic campaign validated, with independent review and sampling-sensitivity evidence. Standalone integer/SHA references, resumable serial campaigns and opt-in stopped code inspection are implemented. Exclusive cost attribution remains incomplete. |
| M2 | Exact independently selectable [SHA256MSG2 lowering](../experiments/m2-sha-msg2/README.md) built and passed emitted-WASM tests, four exact-count hot/cold off/on guest fixtures and four held-out capture/restore runs. Independently reviewed production-config Bun diagnostics prove 58.7 million compiled inline MSG2 executions in the SHA phases and zero MSG2 in other measured endpoints. [Screen01](decisions/m2-msg2-screen-01.md) failed selection. The independently reviewed eight-capture sustained-v2 exploration also failed selection: SHA ratio0.9807, drift criterion failed, required344confirmation pairs exceeded the declared32maximum. Matched resource-v2 diagnostics and independent review passed, with cumulative module-input ratio1.00257 (not resident memory). Separate [MSG1 native/emitted-WASM checks](decisions/m2-msg1-correctness-01.md) and all four real exact-count hot/cold off/on ISA runs passed; [independent review](../artifacts/m2-msg1-diagnostic-review-01/review.json) binds93 identities. The unchanged-Bun MSG1 off/on captures and [independent exposure review](decisions/m2-msg1-exposure-01.md) also passed:58713707 compiled inline executions in measured SHA phases, zero MSG1 in other measured endpoints. MSG1 performance remains open. No promotion. |
| M3a | Isolated one-TB source04/runtime01 passed the independently reviewed real off/on-03 pair: 17 gates, exact stale/invalid recovery, separately observed fault classes, isolated active self-modification with a preceding effect exactly once, interrupt and read continuation. [Review](../artifacts/m3-region-pair-review-03/review.json). The first pressure attempt failed its no-flush proof. A new, separately scoped fixed256MiB TB-buffer run passed: ordinary6000-instance retirement, unchanged hard12000 cap, natural GC and selected sentinel reinstantiation with no flush. [Independent pressure replay](../artifacts/m3-region-pressure-review-03/review.json) passed55 identities; exact suspended-call eviction attribution remains open. No fusion or promotion. |
| Pool policy | Both isolated builds and full source/artifact audits passed. Four held-out capture/restore runs passed1536 digest checks. Corrected combined off/on diagnostics and independent review passed pressure, accounting, unwind/rewind and architectural checks; main semantics followed retirement, with no further retirement during main. Matched resource ratio0.73148 passed the1.10 cumulative-byte budget. [Validation and limits](decisions/passive-fifo-validation-01.md). The original finite-horizon set remains incomplete after its600s deadline. Both requested repetitions completed eight captures/four pairs each; independent replay [02](../artifacts/passive-fifo-deadline-v2-review-02/review.json) and [03](../artifacts/passive-fifo-deadline-v2-review-03/review.json) passed. Full-horizon ratios are1.5822453802 and1.4376454658, kept as separate descriptive sets. Their deadlines were prospectively extended to30minutes. User-reported massive uncontrolled host load prevents causal optimization/deoptimization, confirmation or promotion claims. |
| M3b | Isolated budget1 two-block runtime built and source-bound; default off. [Boundary and standalone Asyncify checks](decisions/m3b-boundary-and-asyncify-01.md) passed within their stated scope. The new baseline and typed-recovery OFF/ON pairs each passed 45 gates and 943,364 checks per arm, with all 12 positive enabled body/service windows independently reconciled. Stale-instance recovery resumed the same compiled owner; invalid-descriptor recovery selected a newer generation observed in TCI only. The separate fixed 256 MiB pressure pair passed 112 gates and 6,987 checks per arm, including compiled same-owner reentry after retirement of 6,000 instances and natural charge release under the hard 12,000 cap, with zero TB flush. [Combined independent validation](../artifacts/m3b-census-validation-01/summary.json) and [scope/evidence](decisions/m3b-census-validation-01.md). A subsequent [unchanged-Bun cold OFF/ON pair](decisions/m3b-bun-exposure-01.md) passed 69 gates and 12 results per arm, with zero fusion formation or execution even when enabled. Offline JS and separate Python reconstruction passed. The later [admission diagnostic and original-runtime confirmation](decisions/m3b-bun-admission-01.md) passed with positive fused entries in warmup and integer phases (76.7 million and 76.6 million total). The earlier zero result remains unexplained. The [extended-state OFF/ON pair](decisions/m3b-xstate-preservation-01.md) also passed 45 gates and 47,168 calls per arm, preserving all enabled user XSAVE components in observed XCR0=31 (x87/SSE/YMM/MPX), with twelve positive measured fused windows. The [owning-worker suspension pair](decisions/m3b-worker-suspension-01.md) passed four compiled-sentinel service continuations, sixteen real native Asyncify transitions, exact captured-state equality and single service payments. The generated function had already returned; eleven further candidates exceeded the fixed observation bound. The [guest-alias SMC pair](decisions/m3b-alias-smc-01.md) passed six gates and 24 arithmetic checks per arm: ordinary alias writes change B ADD to SUB and back, with three distinct compiled fused ON owners on the same physical page and zero TB flushes. The [natural guest signal pair](decisions/m3b-natural-signal-01.md) passed eight real virtual timer contexts and full resumed integer states per arm, with positive compiled exposure in every call. All ON signals were observed at A and no natural private B-poll request occurred. The [current-run code attribution pair](decisions/m3b-code-attribution-01.md) binds 76,136,449 compiled and 108,032 TCI attempts to three actual descriptor generations at one PC, with identical 40-byte integer-loop bodies and exact per-phase reconciliation. Measured JSON/SHA/HTTP phases have zero fused exposure. Separate JS/Python replay and plain/ASan/UBSan byte probes passed; combined validation binds 824 identities. The [interrupted-call alias pair](decisions/m3b-signal-alias-01.md) passed eight actual timer-handler writes to B per arm, exact saved and mixed-operation return integer state, and nine compiled ON generations on one physical page. Each patch has positive old/new compiled exposure, older generations remain quiescent, and TB flushes are zero. Combined validation binds 1,015 identities. The generated function had exited before Linux invoked its handler. Complete intermediate state, exact native interrupt-boundary attribution, invalidation of an Asyncify-suspended owner, exposure variability and uninstrumented resource/performance gates remain open. No promotion. |
| M3c | Guarded page reuse remains planned. |
| M4 | Generic standalone SHA compression contract and arbitrary-input tests exist. No integrated guest replacement or Bun routine recognizer exists. |
| M5–M9 | Existing snapshot/packaging compatibility is retained. Further startup, scheduling, Linux personality, cross-architecture and product gates remain planned. |

## M1 implementation

- [Diagnostic overlay](../experiments/m1-profile/README.md): isolated copied
  source, fixed storage, stopped reset/read API, exact observed-entry counters,
  deterministic sampled PC/edge tables with replacement bounds, and x86-64
  syscall entry attempts. Native C fixtures use ASan/UBSan and check the JS ABI.
- [Phase harness](../benchmarks/harness/m1/README.md): unchanged operation
  source, pinned amd64 Bun distroless, snapshot continuation checks, 20 empty
  gates, ten warmup cycles, three ordered 100-call batches per phase, and raw
  process maps. Retained/off/on controls separate the instrumentation choices.
- [WASM references](../benchmarks/wasm-reference/README.md): exact u32
  recurrence, arbitrary-state SHA compression and synchronous complete hashing;
  bounded checked interfaces, explicit ownership/alias rules, incremental
  hashing, and Node/Chrome correctness and component measurements.
- [Exploration design](../benchmarks/plans/m1-exploration-v1.json): one initial
  fresh launch per mode, descriptive observations only, no optimization
  promotion or statistical equivalence claim.
- [Corrected pilot 02](decisions/m1-pilot-02.md): fresh retained/off/on captures
  and a dependent period-263 restore; 4,800 measured calls passed. All 26
  enabled phases have revision1 addressing, zero unknown entry PCs and
  nonempty PC/edge tables. Independent review passed 70,494 checks and rehashed
  91 files. Diagnostic on/off ratios remain descriptive, with material overhead.
- [Resumable campaigns](../benchmarks/harness/campaign/README.md): frozen
  source/package/host-tool identities, immutable attempts, serialized child
  lifetimes, validated adoption after a crash and explicit stale-lock recovery.
- [Stopped code inspection](../benchmarks/harness/code/README.md): bounded
  physical reads under sampled raw CR3, exact page-table traces, code hashes
  and local disassembly. These extra pauses exclude the run from matched
  timing/sensitivity analysis. The first all-unresolved attempt and its source
  are preserved; the actual-runtime FS check covers the corrected open flags.
  The [corrected live inspection](decisions/m1-code-inspection-02.md) captured
  202 windows over a fresh capture and dependent restore. Independent replay
  passed 8,600 checks. All six integer phase-end observations contain the same
  40-byte recurrence body, with the exact workload constants and two-block
  backedge. This is a concrete region target, not acceleration acceptance.

## Recovery checkpoint

The crash left candidate02 built and packaged, but `baseline-02` had no report.
That directory and the subsequent sandbox-denied launch remain untouched.
The completed diagnostic cycle uses `baseline-02-resumed-02`, `off-02`, `on-02`
and `on-restore-263-02`; see the [resumption record](../artifacts/m1-runs/resumption-2026-11-07.json).
Original reviewed harness/analyzer sources are preserved in
`artifacts/m1-harness-source-v2/` and `artifacts/m1-analysis-source-v2/`.
The independent-review script intentionally rejects later source drift when
run against the current tree; reconstruct those recorded sources to replay its
original complete identity check. Raw report evidence remains immutable.
The [final validation record](../artifacts/m1-resumption-validation.json)
contains test counts, run identities, the preserved failed inspections and the
real two-step resume check. [AGENT_HANDOFF.md](../AGENT_HANDOFF.md) records the
next implementation step and the source/evidence locations.

## Remaining attribution gates

The observed dispatch entries are not retired instruction counts or elapsed
CPU fractions. Same-TB loops are not counted internally. Anonymous executable
maps do not identify JSC tiers or code generations. Stopped phase-end byte
captures do not prove the code generation at every earlier sample. AOT/translation
plan replay is unsupported by this diagnostic overlay and disabled by the
harness. Only the single-vCPU amd64 campaign is in scope.

Existing stage timers overlap and may include suspension. Syscall entry counts
cannot identify blocked time. The HTTP workload is guest loopback, so its next
diagnostic must address runtime/kernel/scheduling behavior before attributing
anything to virtual NIC transport. Existing MMU diagnostics omit inline TLB
hits and cannot establish their proportion of total memory traffic.

Standalone wasm32 components provide a practical reference, not an integrated
memory64 guest acceleration result. Checked and copied costs are reported
separately. An unchanged-Bun SHA substitution still needs a verified ABI and
memory/fault/invalidation contract, or explicit guest cooperation.

No new production default is selected by an instrumented run. The next engine
candidate needs independent switching, exact semantic fixtures, demonstrated
guest exposure, an uninstrumented screen and fresh paired confirmation.

The latest M3b fixture captures establish diagnostic correctness and lifetime
behavior. The initial unchanged-Bun pair recorded zero fusion activity. The
[admission diagnostic and original-runtime confirmation](decisions/m3b-bun-admission-01.md)
then recorded positive fused entries in warmup and integer phases with all
workload checks passing. The added observer is not required for that exposure;
the variation from the earlier zero result is unexplained. These are diagnostic
counts, so no application speedup has been demonstrated. The earlier
[RNDS2 confirmation](../../native-build/bun-inline/RESULTS.md)
remains a scoped 13.84% reduction in snapshot-replayed SHA time versus its
PSHUFB control; it is not a new gain from this resumed implementation. MSG1
performance is unconfirmed, MSG2 did not pass performance selection, and the
[passive FIFO repetitions](decisions/passive-fifo-load-affected-repetitions-01.md)
remain descriptive under uncontrolled heavy host load. A new combined runtime
has not yet demonstrated that it closes the native-performance gap in PLAN.md.

The [fresh M3b uninstrumented comparison](decisions/m3b-idle-timing-01.md) now
provides a documented no-gain result: twelve new matched cold launches passed
14,400 measured checks. ON versus the original RNDS2 baseline took 18.31% more
full-sequence time, 3.6495 times the integer time and 19.80% more JSON time.
SHA/HTTP differences remain inconclusive. OFF also showed overhead, so the
regression is not attributable solely to fusion. Same-author Python/JS replay
and the 523-identity audit passed. M3b remains partial/default off, with
resource and remaining semantic gates open. This is separate from the older
loaded FIFO sets and does not update native/snapshot performance ratios.


## Engine source investigation

[Version-pinned V8, Node, Bun and Bun-pinned JSC checkouts](../research/engines/README.md)
now document the actual nested execution path. The Chrome VM runs on Chrome's
V8; Node orchestrates it. Guest Bun's JSC compiles guest x86 code, while our
TCG/Wasm backend and V8 compile the outer execution. The unchanged workload
instantiates no guest Wasm. Native Wasm imports already bypass ordinary JS
wrappers, but cross-instance inlining is restricted. Actual per-TB V8 and JSC
tiers remain unobserved.

The [RNDS2 SIMD-setup screen](../research/engines/setup-results-01.md) completed
all twelve fresh three-arm launches plus separate correctness and exposure
checks. It demonstrated no speedup: JSON candidate/original ratio 1.034,
SHA-256 0.989, full horizon 1.030, all inconclusive. The matched unchanged
rebuild was retained as a third arm; no run reached the instance cap. Source,
failed attempts and raw journals are preserved. No candidate was promoted.
The [RNDS2 scalar-lane confirmation](../research/engines/lane-v2-confirm-results-01.md)
also demonstrated no gain: primary SHA candidate/original 0.9904
[0.9102, 1.0776], candidate/control 0.9808 [0.9514, 1.0110]. All eighteen
launches passed correctness and cleanup. Its smaller native component code is
not an end-to-end performance result. The [unchanged-RNDS2 memory32 study](../research/engines/memory32-results-01.md)
then passed all correctness checks but failed its horizon primary: candidate /
original 1.0648 [0.9691,1.1699], candidate / rebuild 1.1233 [1.0483,1.2037].
Wasm grew 4.53%, exceeding the predeclared 1% budget. No promotion. The
unchanged-source rebuild had a secondary 0.9479 horizon ratio against original;
the [distinct twelve-launch confirmation](../research/engines/rebuild-confirm-results-01.md)
failed to reproduce it: horizon ratio 1.0481 [0.9513,1.1548]. No source
optimization or rebuild gain is established. The next separate work is MSG1
performance, with identical-binary off/on choices and original RNDS2 reference.
