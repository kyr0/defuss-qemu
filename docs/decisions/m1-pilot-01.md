# M1 pilot 01: exposure findings before corrected PC attribution

Status: exploratory evidence recorded on 2026-11-07. No production optimization
is selected or promoted by this document. The corrected candidate 02 is being
built/run separately; its results must be reported separately rather than
rewriting this pilot.

The aggregate counters support three concrete investigations: repeated compiled
dispatch for integer work; admission pressure plus 128-bit/helper traffic for
JSON; and SHA schedule/128-bit helper traffic. HTTP has substantial interpreted
and kernel entry exposure, but syscall counts do not establish blocked time.

## Evidence and limits

Read the [pilot analysis](../../artifacts/m1-analysis-01/REPORT.md) and its
[machine-readable analysis](../../artifacts/m1-analysis-01/analysis.json), which
link the original inputs. Raw reports are preserved:

| Mode | Raw report | Report SHA256 |
| --- | --- | --- |
| Retained RNDS2 baseline | [baseline-01](../../artifacts/m1-runs/baseline-01/report.json) | `1fc29d85ef0d2f21f153df571cc7d889f710e1687a1901286c43bd87278c12ad` |
| Diagnostic image, suite disabled | [off-01](../../artifacts/m1-runs/off-01/report.json) | `e17930134f6dc5c4c05077e40fdf29ffa478cbcf26449f87e3ebe87381373046` |
| Same diagnostic image, suite enabled | [on-01](../../artifacts/m1-runs/on-01/report.json) | `2e3ce0c599a1e80b4017592bd6d44f98805ac2f1b5a966fb1291b8592d9a0cc8` |

All use Chrome `157.0.8103.38`, protocol `defuss-m1-v1`, and workload bundle
`31d28add91e5a78aee775e57a365828f2b75843fc9bbd26b66bfe06e9d4717d5`.
The unchanged operations use 10 warmup cycles and three ordered 100-call
batches per workload. There is one launch per mode; the three batches share
VM/JIT/pool state and are not independent repetitions. Baseline versus off also
compares retained versus rebuilt runtime artifacts. On versus off measures the
whole diagnostic suite, not isolated PC-sampler cost.

**Every observed guest PC in on-01 is unknown.** The first overlay deliberately
omitted `CF_PCREL` TBs without reconstructing their runtime PC; this guest uses
that form throughout the measured execution. `unknownPcEntries` equals the sum
of interpreted and compiled entries in every batch. PC/edge tables are empty;
zero table replacements or edges therefore does not demonstrate coverage or
absence of transitions. Aggregate entry/admission/privilege, helper, syscall
and existing stage counters remain usable within their documented scopes.
Candidate 02 addresses this PC gap. Pilot 01 cannot identify an exact integer
loop, code generation, SHA function, or hot cross-TB edge.

`initialized.maps` and `post-warmup.maps` in each raw-report directory retain
exact hashed process mappings. They do not establish later code bytes, later
JIT mappings, JSC tier, or a process identity for a sampled CR3. Privilege
classification uses architectural x86 flags, not an address-sign heuristic.

Counter intervals start before the start ACK and end after the result has
arrived and the VM is stopped. The result-to-stop tail is included in counters
(7.3–16.9 ms in these measured batches) but excluded from the host endpoint.
UART/control activity can appear in all phases. Timers are inclusive and may
contain suspension: held interpretation is a subset of interpretation, helper
timing nests in execution, and emission nests in translation. They must not be
summed into an exclusive CPU-time or wall-time breakdown. Sampled helper
microseconds must not be multiplied into an asserted CPU-time share.

## All three host intervals

Each cell lists samples **0 / 1 / 2**, in milliseconds per 100 calls. Calibration
is retained in raw reports and has not been subtracted.

| Workload | Retained baseline | Diagnostic off | Diagnostic on |
| --- | --- | --- | --- |
| Integer | 482.405 / 493.945 / 437.245 | 790.880 / 512.815 / 519.615 | 920.860 / 683.745 / 688.075 |
| JSON | 4797.980 / 2915.985 / 3349.240 | 5209.815 / 3011.425 / 3496.995 | 8613.675 / 3811.675 / 4557.905 |
| SHA256 | 2610.005 / 2346.595 / 2292.910 | 2664.825 / 2469.390 / 2422.490 | 3455.275 / 2857.705 / 2734.115 |
| HTTP | 4161.155 / 3980.780 / 3248.440 | 4445.395 / 4225.530 / 4345.790 | 5592.955 / 4446.775 / 4190.455 |

The first JSON batch is materially different from later batches. Keep that
observation: a median alone hides continuing compilation/cache/pool activity.
These values do not establish significance, noise equivalence, a stable
instrumentation bound, or an optimization speedup.

## Dynamic entry exposure

These are counts of entries into compiled functions or interpreted TBs,
including direct interpreted chaining. Internal same-TB loops are not additional
entries; faults can prevent completion. Percentages below are **entry
fractions, never CPU-time fractions**. `admissionHeld` counts admission-function
observations whose counter has reached the nominal hot limit but whose
admission is deferred; it is not a count of unique TBs.

| Phase/sample | Compiled entries | Interpreted entries | Compiled entry fraction | Kernel entries | Kernel entry fraction | Admission-held observations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Integer 0 | 50,158,525 | 419,903 | 99.170% | 453,599 | 0.897% | 286,495 |
| Integer 1 | 49,858,251 | 508,939 | 98.990% | 335,335 | 0.666% | 468,387 |
| Integer 2 | 50,069,341 | 382,911 | 99.241% | 403,489 | 0.800% | 343,976 |
| JSON 0 | 58,754,070 | 23,253,020 | 71.645% | 7,422,758 | 9.051% | 15,807,311 |
| JSON 1 | 67,731,220 | 4,583,696 | 93.661% | 3,409,584 | 4.715% | 3,673,228 |
| JSON 2 | 68,001,600 | 7,900,717 | 89.591% | 3,232,178 | 4.258% | 5,790,393 |
| SHA256 0 | 3,513,816 | 3,240,171 | 52.026% | 1,814,517 | 26.866% | 1,859,235 |
| SHA256 1 | 3,737,484 | 2,210,625 | 62.835% | 1,391,234 | 23.390% | 1,966,962 |
| SHA256 2 | 3,618,302 | 1,889,725 | 65.691% | 1,245,720 | 22.616% | 1,830,599 |
| HTTP 0 | 6,179,397 | 22,478,676 | 21.563% | 17,557,250 | 61.265% | 12,288,418 |
| HTTP 1 | 7,219,948 | 17,594,141 | 29.096% | 15,998,642 | 64.474% | 14,470,298 |
| HTTP 2 | 7,565,383 | 18,142,066 | 29.429% | 16,468,835 | 64.063% | 17,337,513 |

Existing stage timers, milliseconds, again samples **0 / 1 / 2**:

| Phase | Inclusive interpreted interval | Held-interpreted subset |
| --- | --- | --- |
| Integer | 128.650 / 85.160 / 87.900 | 87.486 / 71.352 / 74.726 |
| JSON | 4288.745 / 988.140 / 1472.880 | 2504.284 / 721.595 / 996.675 |
| SHA256 | 745.950 / 446.780 / 381.605 | 373.294 / 384.606 / 353.554 |
| HTTP | 4541.415 / 3651.115 / 3512.525 | 2715.591 / 2916.676 / 3241.203 |

These inclusive timers strengthen the case for investigating interpretation
and admission, particularly HTTP and JSON. They do not establish how much of
the interval is exclusive CPU work, helper work, suspension or waiting.

## Admission pressure precedes the hard instance cap

The policy in [wasm64.c](../../engine/qemu/tcg/wasm64.c), `inc_counter`, uses the
charged instance pool. It includes retired exports until their GC callbacks
complete. This Chrome run has a 12,000-instance budget and configured hot limit
1,500. Already-compiled cache hits bypass admission; normal new candidates face
the following thresholds:

| Charged pool | Fraction | Required TB executions |
| --- | ---: | ---: |
| Below 6,000 | Below 50% | 1,500 |
| 6,000–9,599 | 50–<80% | `max(1500, hotLimit)` = 1,500 here |
| 9,600–10,799 | 80–<90% | 6,000 |
| 10,800–11,399 | 90–<95% | 24,000 |
| At least 11,400 | At least 95% | 96,000 |

Occupancy is checked at the initial threshold and every 128 further executions.
Thresholds may therefore round up to a check point (6,000 to 6,016; 24,000 to
24,064). At this configured hot limit, the 50% tier changes nothing; it matters
when a lower nominal hot limit is selected. Known-hot/deferred-retranslation
cases have special paths; this table is not a universal threshold for every TB.

Observed charged pools, before → after each measured phase:

| Phase | Sample 0 | Sample 1 | Sample 2 |
| --- | --- | --- | --- |
| Integer | 10,552 → 10,557 | 11,400 → 11,402 | 11,402 → 11,402 |
| JSON | 10,557 → 11,245 | 11,400 → 11,400 | 11,402 → 11,402 |
| SHA256 | 11,245 → 11,251 | 11,400 → 11,400 | 11,402 → 11,402 |
| HTTP | 11,251 → 11,398 | 11,398 → 11,400 | 11,402 → 11,402 |

The first integer batch already begins above 80%; JSON sample 0 crosses 90%.
HTTP sample 1 reaches 95%, after which ordinary candidates require 96,000
executions. JSON sample 0 installs 688 instances and reports one TB-cache
flush; its later samples install zero and report zero flushes. That is evidence
of changing warm state, not a stationary workload sample.

`instanceBudgetRejects` and `budgetInterpreted` are zero throughout. These
describe the later failed-reservation path at the hard cap. They do **not**
mean that admission pressure is absent: the earlier soft policy intentionally
keeps visits interpreted before a reservation is attempted. The measured held
observations and held-interpreted intervals show that path is active. Raising
the cap without measuring instance memory, retirement/GC and compile costs is
not justified by these counts.

Use the new `admissionCalls`/`admissionHeld` counters for admission exposure.
The older field named `admissionChecks` actually increments in `add_instance`
and tracks installs. Also distinguish `admissionHeld` observations (including
internal interpreter chains) from `heldInterpreted` outer timed interpreter
invocations; their units differ.

## Phase-specific next targets

### Integer: dispatch and retained state

Each batch executes 25,000,000 original recurrence iterations. Observed
compiled entries per recurrence iteration are **2.006341 / 1.994330 / 2.002774**.
Compiled helper calls are only **39,830 / 8,176 / 11,303** for the whole batch.
The near-two-entry pattern favors investigating repeated dispatch and
architectural-state transfer over specializing an integer helper. It does not
yet prove a particular two-PC loop: other guest/control activity is included
and every PC in this pilot is unknown.

After candidate 02 supplies valid code/edge evidence, identify the actual loop,
build the one-TB region scaffold with exact recovery, then test the measured
two-block edge if warranted. Preserve interrupt/service budgets, invalidation,
fault/exit behavior and a reference fallback. Ordinary TB dispatch is through
C compiled to WASM, not a JavaScript boundary for every TB.

### JSON: admission, 128-bit transfers and byte-vector helpers

Compiled-helper call counts, samples **0 / 1 / 2**:

| Helper | Calls |
| --- | --- |
| `ld_i128` | 9,301,017 / 10,891,876 / 10,906,195 |
| `st_i128` | 2,576,039 / 3,138,831 / 3,186,925 |
| `lookup_tb_ptr` | 6,348,555 / 7,644,836 / 7,661,711 |
| `gvec_umax8` | 1,241,040 / 1,433,526 / 1,433,522 |
| All compiled helper calls | 23,641,008 / 28,428,299 / 28,520,495 |

The admission evidence and these repeated transfers justify isolated
experiments on admission/translation reuse, exact 128-bit load/store paths,
and byte-maximum lowering or helper argument forwarding. Confirm the
executing PCs/lowering first. Preserve cross-page, alignment, permissions,
MMIO and exception semantics; a helper count does not authorize bypassing
guest memory translation. Generic MMU samples exclude inline clean TLB hits,
so this pilot cannot compute a clean-hit percentage or prove scalar-memory
bookkeeping is the leading JSON cost.

### SHA256: schedule helpers and 128-bit transfers

Compiled-helper call counts, samples **0 / 1 / 2**:

| Helper | Calls |
| --- | --- |
| `ld_i128` | 32,297,639 / 32,779,993 / 32,779,804 |
| `sha256msg1` | 19,378,584 / 19,668,022 / 19,667,995 |
| `sha256msg2` | 19,378,728 / 19,668,128 / 19,668,092 |
| Unidentified slot 6426 | 25,838,064 / 26,231,562 / 26,223,961 |
| Unidentified slot 6890 | 19,378,584 / 19,668,022 / 19,667,995 |
| All compiled helper calls | 117,901,927 / 119,754,718 / 119,693,578 |

Each batch hashes 1,600 inputs of 65,536 bytes, or 1,640,000 SHA compression
blocks including padding. Later batches have approximately 20 `ld_i128` and
12 each MSG1/MSG2 helper calls per compression block. This supports exact SHA
schedule lowering, 128-bit transfer and helper forwarding work. The unnamed
slots must remain unnamed until metadata is verified. The RNDS2-specific
inline counter is unavailable (`null`) in this pilot; that is not a measured
zero and does not quantify RNDS2 lowering.

The standalone complete-hash median is approximately 2.69 ms per original-sized
job versus the retained guest median of approximately 23.47 ms. This is
component headroom, not a promised ninefold integrated speedup: standalone
memory is wasm32/unshared, and it omits Bun crypto-object/hex formatting costs,
guest translation/fault semantics and the integration boundary. Generic bulk
compression requires its exact contract, arbitrary-state fixtures and a
verified guest ABI or explicit cooperation before unchanged-Bun substitution.

### HTTP: kernel/interpreter work and measured wait boundaries

HTTP's interpreted entry fractions are **78.437% / 70.904% / 70.571%**; kernel
entry fractions are **61.265% / 64.474% / 64.063%**. These are dynamic entry
fractions only. Each batch performs 800 guest-loopback requests.

| Linux syscall entry attempts | Sample 0 | Sample 1 | Sample 2 |
| --- | ---: | ---: | ---: |
| `clock_gettime` | 17,898 | 16,345 | 16,445 |
| `epoll_pwait2` | 2,984 | 2,961 | 2,899 |
| `recvfrom` | 2,400 | 2,400 | 2,400 |
| `getsockopt` | 2,400 | 2,400 | 2,400 |
| `sendto` | 1,600 | 1,600 | 1,600 |
| `setsockopt` | 800 | 800 | 800 |
| `write` | 1,810 | 1,842 | 1,840 |
| `futex` | 628 | 725 | 912 |

Investigate admission/interpreter overhead and add bounded syscall
completion/wait/wakeup measurements. Entry counts alone do not establish
blocking time, successful completion, redundant calls or scheduler latency.
They cannot select a scheduler rewrite or justify replacing syscalls with host
operations. The workload uses guest loopback and no virtual NIC; these results
do not identify a virtual-NIC optimization target.

## Gate before selecting an implementation experiment

1. Validate candidate 02 PC reconstruction and collect useful bounded PC/edge
   evidence, including sampling-period sensitivity and code/mapping provenance.
2. Retain all batches and distinguish warm-state/pool transitions from steady
   work. Measure disabled/enabled perturbation with additional matched launches
   when needed; do not treat this one triplet as confirmation.
3. Select one exact path supported by both execution exposure and semantic
   fixtures. Keep its feature switch independent and compare uninstrumented
   reference/candidate behavior, footprint and elapsed endpoints.
4. Improve suspension-aware time accounting where the proposed change depends
   on an exclusive cost claim. Do not infer missing fractions from entry or
   helper counts.

Pilot 01 supplies useful aggregate exposure and concrete hypotheses, while
leaving the PC/edge, exact routine identity and exclusive-time parts of M1
incomplete. The later corrected-candidate report is the place to advance those
gates.
