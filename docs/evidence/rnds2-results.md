# Incremental Bun amd64 intrinsic results — 6 November 2026

**Direct compiled SHA256RNDS2 reduced SHA replay time by 13.84% relative to
the measured PSHUFB runtime.** Independent confirmation used eight new
capture pairs; RNDS2 won all eight. The paired control/candidate ratio is
**1.1605733203**, with an approximate 99% paired-bootstrap interval of
**[1.1160614015, 1.2089701839]**. This corresponds to **10.40%–17.28% lower
time**, beyond the predeclared ±5% ratio band for this workload and protocol.

The result applies to snapshot-replayed SHA work in Bun 1.4.4 distroless,
Linux amd64, Chrome 157.0.8103.38 on this macOS 26.7.1 arm64 host. It does
not establish the same gain for JSON, integer work, HTTP, other applications,
or a fully converged host JIT. It is an incremental comparison against
PSHUFB; do not multiply it by a historical speed estimate against another
control. Original app/runtime defaults remain preserved.

## Implemented candidates

Each candidate includes the previously measured PSHUFB lowering and adds one
isolated experiment:

| Candidate | Change | Performance evidence |
|---|---|---|
| `rnds2` | Emit the two SHA rounds directly with exact i32 arithmetic, captured XMM0 words and all input reads before output stores; retain the original interpreter helper | SHA gain independently confirmed |
| `setup` | Forward registers into selected pure PSHUFB/min/equality/mask intrinsics before generic helper argument setup, with exact metadata/ABI guards | SHA and JSON screening only |
| `pmaxub` | Specialize 128-bit unsigned-byte maximum in both its C helper and compiled intrinsic; retain the MMX/YMM paths | JSON screening only |

The RNDS2 production runtime is in [`rnds2/runtime`](rnds2/runtime).
Its WASM SHA256 is
`ecfbc2b4efa6cffaf2b1a22e2d511f6a1e429c6f70c98aafe665176712c8bad4`;
its JS SHA256 is
`2593a7d8d08971578bc68cab6d032408093d3d4bde0353bc085fcaf96c1adb9c`.
The reusable Bun bundler can package it with
`--runtime-dir native-build/bun-inline/rnds2/runtime`.
The candidates have not been combined with one another or promoted to a default.

## Selection and independent confirmation

The restarted screens used two independent capture pairs each, with two fresh
browser restores per snapshot. All 36 screen VMs passed. These are exploratory
estimates with only two pairs, not independently established gains:

| Workload | Candidate | Paired control/candidate ratio | Estimated lower time |
|---|---|---:|---:|
| SHA256 | RNDS2 | 1.218055 | 17.90% |
| JSON | Setup | 1.214513 | 17.66% |
| JSON | PMAXUB | 1.146237 | 12.76% |
| SHA256 | Setup | 1.055263 | 5.24% |

The predeclared rule selected the largest ratio above one across all four
comparisons. RNDS2/SHA narrowly exceeded setup/JSON; that difference does not
establish that RNDS2 is generally the better optimization. The immutable
[`joint-selection-02.json`](results/joint-selection-02.json) binds both completed
screens, their raw evidence, the ranking and the selected package identities.

[`confirm-rnds2-sha256-02`](results/confirm-rnds2-sha256-02/REPORT.md) contains
**16 fresh captures and 32 fresh restored VMs**, all passed. Its 96 measured
restored batches are nested within eight independent capture pairs. Every
snapshot observation is the median of two VM medians, each derived from three
20-call host-timed batches. Effect estimation uses the geometric mean of the
eight paired ratios. No observations were removed; capture timings, screens,
pilots and instrumented runs are excluded.

The approximate 99% percentile interval uses 50,000 fixed-seed bootstrap draws
at the capture-pair level. Small-sample bootstrap uncertainty remains a limit.
All raw events and CSV tables are retained. The independent checker separately
reconstructs batch durations, nested medians, selection and bootstrap from raw
events; see [`independent-review.json`](results/confirm-rnds2-sha256-02/independent-review.json).

The fixed schedule is 100 guest warmup calls before capture, 60 after ACK,
then three measured batches of 20 calls. Host translation modules still grow
during some batches. This measures the fixed replay procedure, not proven
steady-state throughput. Restored VM readiness was about 1.13 seconds for both
runtimes; that descriptive value excludes Chrome launch and host input hashing.

## Correctness and actual execution coverage

All six native builds reproduced their unchanged control-object hashes.
Three native suites passed all six guard/helper/metadata exports, including
**675,840 helper/oracle cases**: 20,480 RNDS2 and 655,360 PMAXUB cases.

**15 gated Linux guest fixtures passed 628,736 checks** across 179 completed
modes and 194 gates. They cover baseline, compiled diagnostic, fallback and
production binaries; setup also reuses the wider PSHUFB alias/control-byte
fixture. Counter deltas are read while the guest is stopped. Hot fixtures
prove intended compiled execution per selected mode; fallback fixtures prove
the selected paths remain interpreted. Flags, live scalar registers, aliases,
upper bytes and memory forms are checked within the documented fixture scope.
Guest memory faults are preserved by unchanged translator paths and were not
deliberately synthesized in these fixtures.

The three production runtimes passed all **36 original Bun results**, including
all 12 unique workload/sample identities per VM. Four separate diagnostic
capture/restore pairs passed state and snapshot validation and established
target execution in every restored batch:

| Candidate/workload | Compiled target executions per restored 20-call batch |
|---|---|
| RNDS2 / SHA | 10,489,876; 10,490,070; 10,490,184 |
| Setup / SHA, PSHUFB | 1,311,032; 1,311,404; 1,311,976 |
| Setup / JSON, recognized families | 1,675,958; 1,675,939; 1,675,936 |
| PMAXUB / JSON | 286,714; 286,704; 286,710 |

Diagnostic marker windows include support/console execution and are live,
approximate boundaries; they are not timing or hardware-retirement evidence.
RNDS2 semantic counts are native + inline; its compiled-original counter is a
subset of native and must not be added again. The three restored SHA batches
contain 31,488,000 semantic RNDS2 executions in total. The independent
[`correctness-review.json`](results/correctness-review.json) found no discrepancy.

## Transport failure, repair and retained evidence

The earlier `screen-sha256-01` completed, but `screen-json-01` failed during
PMAXUB capture because Playwright expanded a 100,327,776-byte binary snapshot
upload into a 543,610,028-byte CDP network message. Node could not create that
string, so the runner produced no final report. The campaign summary, log and
already published snapshot remain retained. That failed screen and the earlier
completed SHA screen were both excluded from the restarted experiment.

The harness now uploads sequential 1 MiB chunks and checks ordering, total
length and SHA256 before the existing atomic, fsynced publication and COM1 ACK.
Six host tests passed. Real Chrome transferred the exact failing snapshot in
96 chunks, publishing identical bytes; a production capture/restore pilot also
passed. App bundles, native runtimes, guest schedules, selection and inference
were unchanged. See [`transport-recovery.md`](transport-recovery.md).

Both `02` screens and confirmation froze the repaired harness. Every run
verified app/runtime compatibility, nonce, heap checksum, tmpfs sentinel,
continuation ordinal, budgets, raw hashes and unchanged snapshot bytes/mtime.
Fresh end-of-pass hashes verify both screen archives and all 12 screen
snapshots in [`screen-preservation-final.json`](results/screen-preservation-final.json).
The independent confirmation review rehashes its archived inputs and all 16
confirmation snapshots. All **48 original/control preservation pins** pass in
[`baseline-preservation.json`](baseline-preservation.json).

[`VALIDATION.json`](VALIDATION.json) inventories all retained attempts, including
the failed and superseded campaigns. Its historical campaign membership must
not be mistaken for pooling those observations into the final estimate.
Only the `02` screens select the candidate, and only the eight new confirmation
pairs produce the reported 13.84% result. Reproduction commands and exact
candidate contracts are linked from [`README.md`](README.md).
