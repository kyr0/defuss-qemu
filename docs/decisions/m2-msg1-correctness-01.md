# MSG1 correctness result 01

The isolated, default-off SHA256MSG1 lowering passed native/emitted-WASM
validation and a four-run real guest ISA matrix. This establishes the tested
instruction contract; it does not establish Bun exposure or a speedup.

The original helper oracle supplied 20,480 arbitrary-input/alias cases and
60 unaligned cases to each shared-memory64 and memory32 emitted module.
Native ASan/UBSan, selector races, guard bytes and preserved temporary locals
passed. The independent host audit recomputed every oracle case, including
all ten pointer-alias patterns.

The diagnostic runtime was built from its frozen source using the pinned SDK.
Post-build review compared all 10,101 source files against the 10,099-file
baseline, confirmed exactly five overlay changes, and verified every runtime
artifact. The source fingerprint is
`2b7a8b44cff517fd8a02c30151a47bbc6b1776a4f617ef5d1db952c2a218efa3`.

| Real ISA run | Interpreted | Compiled inline | Compiled original fallback | Successful instructions |
| --- | ---: | ---: | ---: | ---: |
| Hot on | 12,025 | 20,743 | 0 | 32,768 |
| Hot off | 12,022 | 0 | 20,746 | 32,768 |
| Cold on | 32,768 | 0 | 0 | 32,768 |
| Cold off | 32,768 | 0 | 0 | 32,768 |

Each run checks seven operand forms plus a separately warmed fault site. The
faulting 16-byte memory operand crosses a protected page while the first lane
is still readable. Exact PC/address, vector state, flags and the preceding
non-idempotent increment are checked; the fault contributes no helper or
inline execution. All raw markers, gate deltas, late-selector rejection and
fixture/runtime/source bindings passed independent replay. Ten corruption
tests cover the new independent reviewer.

These runs used Node 26.11.1, flags2 and hotness1500 or65535. Production Chrome
flags3 Bun exposure, held-out application/snapshot validation, an uninstrumented
performance build and prospective paired performance evidence remain open.
MSG1 is not combined with the failed MSG2 performance candidate or promoted
into the retained runtime.

Evidence:

- [Host result](../../artifacts/m2-msg1-host-01/report.json) and
  [independent host audit](../../artifacts/m2-msg1-host-review-01/review.json).
- [Full source/runtime recheck](../../artifacts/m2-msg1-diagnostic-build-review-01/review.json).
- [Four-run independent ISA review](../../artifacts/m2-msg1-diagnostic-review-01/review.json)
  (93 identities), with unchanged raw runs at
  `artifacts/m2-msg1-diagnostic-{hot,cold}-{on,off}-01`.
- [Frozen independent reviewer](../../artifacts/m2-msg1-isa-reviewer-source-01/manifest.json).
