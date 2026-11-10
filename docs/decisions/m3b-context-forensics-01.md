# M3b RF fallback accounting investigation

The original 45-gate ON run remains failed. Its exact guest result passed, but
the original counter oracle expected one more fused B attempt than it observed.
The subsequent evidence identifies an accounting gap in the proposed oracle;
it does not retrospectively turn that earlier run into a pass.

The first bounded forensic capture stopped on its 2 MiB pending transport cap
before a complete workload window. The second transport used a fixed 64 MiB
pending cap and completed its trace delivery, then stopped at the unchanged
strict oracle's gate 3 refusal. Both failures and their independent reviews
remain preserved.

The second capture retained 462 chunks and 29,803,202 trace bytes. Its final
queue was empty, its VM was paused, and the owned Chrome processes were gone
before any subsequent execution. Peak pending trace data was 6,881,280 bytes.
These observations establish this capture's transport completeness only.

At gate 3, the unchanged guest checked 550 bodies and produced digest
`3c75319584df60aa`. The fused counter recorded 486 B attempts. Independent raw
trace replay found 64 completed RF A-to-B preludes, nine RF A-to-side exits and
ten exact generic RF A entry refusals. Seven RF B records consisted of three
refusals and four exact body continuations; they add no extra logical bodies.
Recorded control registers, segments and debug context were constant.

The prospective identity is `B = F + R + D`, where F is fused B attempts, R is
completed positive-count ordinary RF A-to-B preludes, and D is initial direct-B
calls. An internal requested exit partitions F into completed fused routes and
ordinary B continuations without adding another body. Extra service payments
remain F. Ordinary B selections are attempts and cannot be counted as retired
bodies.

This numerical identity is not yet accepted: the trace records 552 normal A
entries in the gate 3 window, while native counters record 612 fused entries.
Internal chains can bypass the debug logging site. A new isolated, default-off
native context census is being implemented to cover every selected execution
site and verify the owner/generation/context partition before the host can use
that identity. It will also provide a generation-specific paused recovery
selector while preserving the original PC-only API's ambiguity refusal.

The second capture has a separate reporting failure: the generated Emscripten
loader prepended `./this.program` to its supplied argument array, which had
been shared with the report. The offline inspector accepts only that exact
mutation under the pinned generated-JS hash. The new runner copies the two
arrays independently. No native CLI or guest work is changed.

Evidence:

- [Original failed-prefix diagnosis](../../artifacts/m3b-baseline-on-failure-diagnosis-01/review.json)
- [First transport failure review](../../artifacts/m3b-forensic-transport-failure-review-01/review.json)
- [Second failed-capture review](../../artifacts/m3b-forensic-v2-capture-review-01/review.json)
- [Actual offline inspection](../../artifacts/m3b-forensic-v3-inspection-01/report.json)
- [Full recorded-context audit](../../artifacts/m3b-context-window-audit-01/review.json)
- [RF B continuation audit](../../artifacts/m3b-context-window-audit-01/rf-b-supplement.json)
- [Hidden-chain continuity gap](../../artifacts/m3b-context-continuity-review-01/review.json)

No timing or optimization/deoptimization claim follows from these instrumented
runs. The machine remains under uncontrolled heavy load. The requested original
load-affected timing pilot and two repetitions are separately reported and are
not being extended by this correctness investigation.
