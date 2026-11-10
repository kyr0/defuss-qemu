# M3b boundary and standalone Asyncify validation

The isolated budget1 two-block runtime built successfully. Its real boundary
OFF/ON pair and the separate standalone Asyncify contract passed independent
replay. These results establish bounded contracts, not completion of M3b or a
performance improvement. The first broader ON capture failed a fused-coverage
assertion and remains failed.

## Runtime and native boundary evidence

The [source freeze](../../artifacts/m3b-implementation-source-01/manifest.json)
contains 57 authored files and 315 dependencies. The pinned offline SDK built the
x86-64 runtime with four build jobs. Its source fingerprint is
`b458c012278728289c39b971bb0a7d01fc2a15411eebb4124399d3d72d2551b1`.
The [actual source recheck](../../artifacts/m3b-build-01/source-recheck.json)
and [diagnostic binding](../../artifacts/m3b-diagnostic-binding-01/binding.json)
connect prepared source, SDK completion, graph, assets and runtime bytes.

The original proof tool rejected an inherited QEMU symlink. Its failure remains
in `artifacts/m3b-build-review-01/`. The separately reviewed proof-v2 handles
only the 14 exact inherited internal links and uses the actual build's Path
ordering. The corrected recheck passed; no QEMU source or runtime change was
needed for that proof-tool correction.

| Capture | Gates | Guest calls | Guest checks | Native probes |
| --- | ---: | ---: | ---: | ---: |
| [Boundary OFF01](../../artifacts/m3b-boundary-off-01/report.json) | 11 | 8196 | 163923 | 0 |
| [Boundary ON01](../../artifacts/m3b-boundary-on-01/report.json) | 11 | 8196 | 163923 | 4 |

Both captures produce digest `fe2f670b35c98d95`. Each also passes 12 native
control checks. The real runtime confirms the restricted one-CPU, private
512 MiB RAM/device profile, with vAPIC disabled. The compiler VM is stopped
before and after each capture. The ON probes cover two programs, each with a
budget return and a forced internal B-request exit. They compare integer
registers, architectural and lazy flags, selected mode fields, return state,
owner generation and exact service payment across the native call boundary.

The [independent pair review](../../artifacts/m3b-boundary-review-01/review.json)
replays both raw reports, controls, guest oracles, four probes and input
closure. It supersedes only the frozen report's obsolete draft statement that
the build and real OFF/ON execution were still unexecuted.

## Actual standalone Asyncify evidence

The [v3 standalone build](../../artifacts/m3b-asyncify-build-03/build-report.json)
and [run 02](../../artifacts/m3b-asyncify-run-02/report.json) use the exact service
helper and extracted unchanged `trysleep`, compiled with the pinned SDK as
shared-memory memory64 Wasm. Capacity, GC consumption and CPU context are
explicit fixture stubs. The call executes on the Node caller thread.

The run records two actual native Asyncify episodes, each
`0 → 1 → 0 → 2 → 0`. All eight transitions retain the exact expected before
and after banks; debt is already cleared at every transition. The final bank
confirms four service payments, one requested exit, eight helper returns and
one expected invalid-debt rejection. The
[independent review](../../artifacts/m3b-asyncify-review-01/review.json) also
checks the binary memory64/shared-memory declaration, source/compiler/SDK
closure, and the exact four JavaScript observer edits. The Wasm bytes are
unchanged by observer derivation.

Two earlier failures remain retained. Build 01 rejected a redundant maximum
memory flag while growth was disabled. Build 02 succeeded, but run 01 referenced
an observer helper that JavaScript optimization had removed. The separate v3
source exports that existing helper through a stable Module property before
optimization. It adds no yield. Run 02 uses two source-bound 60-second internal
deadlines; its outer execution record confirms no timeout but does not record
the configured outer timeout value. The original Node executable was not
hashed, which the independent review explicitly records as a provenance limit.

## Broader baseline failure and remaining gates

The [45-gate OFF capture](../../artifacts/m3b-fallthrough-off-01/report.json)
passed. The [first ON capture](../../artifacts/m3b-fallthrough-on-01/report.json)
stopped at gate 8, add64 direct-B: 485 fused B-boundary attempts versus 486
expected. Its guest checks and digest match exactly. The raw native banks
show one fewer compiled A entry, one extra ordinary B entry and one new
ordinary translation. They do not identify that translation's PC/flags.

The [failed-prefix audit](../../artifacts/m3b-baseline-on-failure-diagnosis-01/review.json)
reproduces the mismatch. An interrupt-restored RF flag can legally send A
through an ordinary translation, and that is consistent with the retained
counters. It is not proven for this capture. Ordinary B entry counts are
attempts, so adding them to fused attempts cannot establish executed-body
conservation. A separately versioned bounded trace is being prepared; the
original assertion and failed artifact remain unchanged.

The boundary probes use a forced request and observe Normal Asyncify state;
they do not prove natural interruption or suspension. The standalone actual
Asyncify result does not prove QEMU owning-worker scheduling, generated-region
suspension, dormant-fiber lifetime or natural pressure. Intermediate full
FP/XSAVE state, fused recovery/retirement, self-modification and performance
remain separate acceptance work. The candidate stays default off.
