# M3b current-run Bun code and generation attribution

The single predeclared OFF/ON pair passed all 69 gates and 12 unchanged Bun
results per arm. ON's **76,136,449 compiled and 108,032 TCI entry attempts** are
now bound to exact translation bytes and three descriptor generations, with
per-generation totals reconciling the original counters at every observation.
The [combined validation](../../artifacts/m3b-bun-code-attribution-validation-01/summary.json)
passed 824 identities. This closes the bounded current-run code attribution
gate; M3b remains partial and off by default. No speedup or promotion is claimed.

| Phase | Compiled entry attempts | TCI entry attempts |
|---|---:|---:|
| Warmup | 1,243,877 | 6,016 |
| Integer sample 0 | 24,992,151 | 6,016 |
| Integer sample 1 | 24,998,150 | 0 |
| Integer sample 2 | 24,902,271 | 96,000 |
| All measured JSON / SHA / HTTP phases | 0 | 0 |
| Whole ON capture | 76,136,449 | 108,032 |

OFF had zero formations and zero fused attempts. No capture was repeated or
selected for positive exposure. These are entry attempts, not completed bodies,
retired instructions, time shares, or an estimate of the potential speedup.

## Exact code and generation evidence

All three rows have translation and first/last entry PC `0x7fce7cc898a9`,
physical page/address `0x1c0388a9`, and identical 40-byte admitted spans. Their
formation/first/last CR3 values are `0x21a4000`. Each row has its own TB owner,
code pointer and monotonically increasing descriptor generation:

| Generation | TB owner | Code pointer | Compiled attempts | TCI attempts | First observed gate |
|---|---|---|---:|---:|---:|
| `0x72477` | `0x87898c0` | `0x8789980` | 1,493,863 | 6,016 | 43 |
| `0x75d1a` | `0x1e97300` | `0x1e973c0` | 50,035,706 | 6,016 | 46 |
| `0x8996a` | `0x1ed2d40` | `0x1ed2e00` | 24,606,880 | 96,000 | 68 |

The byte SHA256 is
`33bf7bb51940030c9f3a4f6b6b60a50d813563a0f0bb03af0a47248cf26368a6`.
[Byte inspection](../../artifacts/m3b-bun-code-attribution-bytes-01/report.json)
and the [disassembly](../../artifacts/m3b-bun-code-attribution-bytes-01/slot-01-gen-72477.txt)
show nine instructions: SAR, XOR, IMUL, ADD, INC, CMP, conditional side exit,
SHL, and the backedge. The multiplier `0x19660d`, increment `0x3c6ef35f`, and
loop bound `0x3d090` match the workload's 1,664,525, 1,013,904,223 and 250,000.
Together with phase exposure, this supports attribution to the integer
recurrence. It does not identify a JSC tier or a source-function symbol.

The unchanged C predecoder accepted each exact span in plain and ASan/UBSan
host probes: 40 bytes, nine instructions, B offset 31, side exit offset 40,
backedge offset 35. Removing the final branch byte was rejected in both modes.
Disassembly used synthetic ELF containers solely to preserve the PC and bytes;
those containers are not guest executable files.

At the initialized and post-warmup maps gates, process 423 reported the PC
inside anonymous `rwxp` range `7fce7cc65000-7fcebcc65000`. Both raw maps and
their hashes are retained. These are named-gate associations, not proof of
mapping contents at every translation or process identity derived from CR3.
No historical generation identity is inferred from matching bytes.

## Implementation and validation

The [runtime binding](../../artifacts/m3b-code-attribution-binding-01/binding.json)
connects a four-file observation-only overlay to the unchanged original ABI2
runtime. Complete before/after inventories contain 10,115 files and 14 links;
source fingerprint is
`75d820fcfedd53d6e1c71cf90ac36b6ae388c91997fad4c5dc85da58cbbdeaef`.
The pinned SDK build passed all 1,566 steps. Original admission, IR, descriptor
layout, guards, service function, countdown, hard cap and default are unchanged.

The fixed bank holds at most sixteen formations. Formation copies only the
already admitted RAM span; execution records scalar identity and counters,
without reading guest memory or retaining native/JavaScript objects. Overflow,
unmatched attempts, saturation and identity errors are all zero. Host models
cover owner-address reuse, new generations, invalid identities, bounds,
saturation and unchanged execution state in plain and ASan/UBSan variants.

The frozen browser harness passed 21 Node tests, ten syntax checks and a
controller AST check. Actual runtime preflight passed before capture. Both
captures passed frozen JavaScript replay and the
[separate Python reconstruction](../../artifacts/m3b-bun-code-attribution-review-01/review.json),
which checked 789 identities after seven corruption-test methods. All were
authored by the same root agent; this is not an external independent audit.
Raw serial and observation rows were fsynced before ACK; both owned-browser
cleanup audits passed. Source freezes and verified project checkpoints retain
the work, with all scratch under `defuss-vm/tmp`.

ON recorded 76,243,683 B attempts and exactly as many service payments, zero
entry rejects or debt errors, and four B requests without injected controls.
Those requests do not identify an interrupt source or exact delivery state.
Both arms had seven ordinary TB flushes; this experiment does not assert
no-flush execution. Final instance charges were 11,437 OFF and 11,401 ON under
the unchanged 12,000 cap; both reserved 2 GiB of linear memory. These quantities
are not resident-memory or uninstrumented resource results.

The earlier timing pilot and exactly two requested load-affected repetitions
remain complete and separate. This observer adds execution-path work and is
ineligible for timing conclusions, especially under the reported host load.
Remaining M3b gates include complete intermediate architectural state, exact
natural B-poll delivery, suspended-owner invalidation, active-call later-block
SMC, exposure variability, and uninstrumented resource/performance acceptance.

Follow-up: the [interrupted-call alias pair](m3b-signal-alias-01.md) subsequently
combined natural guest signal contexts with handler writes to the later loop
block. Exact mixed-operation results and nine compiled replacement generations
passed; active generated-frame and Asyncify-suspended-owner mutation remain
outside that scope.
