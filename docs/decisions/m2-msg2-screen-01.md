# SHA256MSG2 screen 01: promising SHA result, failed selection

The first uninstrumented screen did **not** select the candidate. One fresh
off/on capture pair used the unchanged M1 bundle and the same new runtime
artifact. Only the startup MSG2 lowering choice differed. The prespecified
screen required SHA time below 0.95 of control and each other workload below
1.10. No result was excluded or retried.

| Endpoint | Candidate/control median-time ratio |
| --- | ---: |
| SHA256 | 0.8478 |
| Integer | 1.0048 |
| JSON | 1.2436 |
| HTTP | 0.9792 |
| Capture readiness | 1.0823 |

SHA was 15.2% lower in this descriptive pair, while JSON was 24.4% higher.
This is neither a confirmed improvement nor evidence that the JSON difference
is merely noise. The maximum result-to-stop proxy was also higher: ratio
3.7283, including a 45.97 ms candidate HTTP tail. No promotion follows.

The retained [plan](../../artifacts/m2-screen-plan-01.json),
[frozen campaign](../../artifacts/m2-screen-01/frozen.json),
[analysis](../../artifacts/m2-screen-analysis-01/analysis.json) and
[independent Python review](../../artifacts/m2-screen-review-01/review.json)
bind the source, runtime, package and protocol identities. Independent replay
passed and reproduced the failed selection.

## Evidence for the next experiment

The protocol used only ten warmup calls per workload. Its measured batches
were still changing substantially:

| Workload | Control batch times, ms | Candidate batch times, ms |
| --- | --- | --- |
| JSON | 7027, 3299, 3744 | 5287, 4656, 4042 |
| HTTP | 6066, 5491, 4466 | 6409, 5376, 3903 |
| SHA256 | 3019, 2499, 2364 | 2861, 2044, 2119 |

The charged instance pool grew from 10,572 after warmup to 11,402 at completion
for control, and 10,723 to 11,582 for candidate. Both observed linear memories
were 2 GiB. The retained admission implementation in
[`inc_counter`](../../engine/qemu/tcg/wasm64.c:372) raises the compilation
threshold from 1,500 to 6,000 executions at 9,600 charged instances, to 24,000
at 10,800, and to 96,000 at 11,400. The measured runs crossed those bands at
different points. Net charges do not reveal all retirement or reinstantiation.

These observations support investigating warmup and admission evolution. They
do not isolate the cause of the JSON difference: control JSON also rebounded
13.5% between its second and third batches. The candidate only replaces MSG2
emission; unrelated helpers still incur a translation-time match attempt when
enabled, and indirect compilation/code-memory effects remain possible.

The 12 GiB compiler VM remained running but idle during this first screen.
Host free-memory observations are retained in both reports. A subsequent
`vm_stat` observation showed about 13 GiB occupied by the compressor; that was
observed after the screen, not sampled during every benchmark phase.

The next experiment uses a new sustained-run protocol identity: five fixed
100-call warmup batches per workload, then eight measured 100-call batches in
balanced workload orders. It records warmup and measured pool observations,
retains every completed observation, and uses four fresh exploratory pairs.
Warmup is fixed rather than extended until a favorable result appears. The
compiler VM must be stopped before fresh timing runs. Margins stay unchanged;
continued tier/admission evolution remains visible and is not called a proven
steady state. Any confirmation uses fresh captures under a separately frozen
plan and sample count informed by exploratory variance.

## Correctness already verified

The switch runtime built successfully from its frozen source; the post-build
fingerprint matched all 10,101 input files. Both off/on full-system ISA runs
passed 28,672 ordinary checks and the warmed cross-page fault case, including
exact fault PC/address, vector state, flags and one preceding store. Four
held-out off/on capture/restore runs passed 1,536 digest checks with unchanged
input buffers and exact retained snapshot bytes. These results establish
correctness for those cases, not performance acceptance.

Exact diagnostic execution counts, actual unchanged-Bun compiled-path exposure
and separate generated-module byte accounting are still required. Diagnostic
timings must never enter uninstrumented inference.
