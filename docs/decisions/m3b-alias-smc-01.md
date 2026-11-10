# M3b invalidation through a guest virtual alias

The revised OFF/ON pair passed all six gates and 24 arithmetic checks per arm.
The guest changes only the opcode of block B through a writable virtual alias,
from ADD to SUB and back. ON replaces the compiled fused A+B owner after both
writes and executes the changed arithmetic correctly. OFF can retain ordinary
A because its instructions did not change. Neither arm flushes the TB cache.

The [combined validation](../../artifacts/m3b-alias-smc-v2-validation-01/summary.json)
passed 835 identities. Both frozen JavaScript offline inspections passed, and
the [separate Python reconstruction](../../artifacts/m3b-alias-smc-v2-review-01/review.json)
passed 779 identities. These implementations have the same root author; they
provide separate-language validation, not an external independent source audit.

## Exact guest operation

The guest maps one memfd page at RX `0x20000000` and RW `0x21000000` using
`MAP_SHARED`. At every gate, the raw `/proc/self/pagemap` entries show present,
unswapped mappings of the same nonzero physical frame. Both aliases expose the
same exact seventeen bytes. The native owner census places A at offset four
on that same physical page. No assumed alias identity substitutes for the
actual page-table evidence.

The guest performs exactly two one-byte writes at RW offset nine: opcode
`01` becomes `29`, then `01` again. These are ordinary guest stores between
calls to warmed code. No native mutation, forced collection, countdown reset,
capacity bypass or global invalidation is introduced. The original ABI2 native
runtime and its default-off candidate, hard 12,000-instance cap, 50,000-turn
service countdown and guards remain unchanged.

Each arithmetic epoch uses eight fixed iteration counts and step values. All
24 modulo-32 results match an independently computed ADD/SUB/ADD reference.
The stopped watch/census is reset only at layout and the two patch gates,
after the complete raw observation is durable, giving epochs 4, 8 and 12.
The patch gates show increased ordinary invalidations and unchanged watched
entry counts before the next invocation. All gates have zero TB flushes.

| ON epoch | Opcode | Fused generation | Compiled / TCI entry attempts | B attempts / service paid |
|---|---|---|---:|---:|
| Initial | ADD | `0x13cb7` | 433,662 / 1,500 | 435,047 / 435,047 |
| Patched | SUB | `0x13e00` | 433,663 / 1,500 | 435,045 / 435,045 |
| Restored | ADD | `0x13e0a` | 433,671 / 1,500 | 435,046 / 435,046 |

All three ON generations have distinct descriptor and code addresses, positive
compiled exposure at exact A `0x20000004`, and the same physical frame
`0xe7e8`. OFF retains ordinary A generation `0x13a25` on its own frame
`0x197e5`, with compiled counts 433,707, 435,207 and 435,207. Frames are required
to remain equal between aliases within an arm, not across independent boots.
Counts represent entry attempts, not retired bodies or time fractions.

## Provenance and corrected control expectation

The first frozen OFF capture stopped after the SUB epoch because its host
oracle incorrectly required ordinary A to be replaced after a B-only write.
Its sixteen completed arithmetic checks and alias bytes were correct. That
[failed capture decision](../../artifacts/m3b-alias-smc-off-failure-01/decision.json)
and raw evidence remain intact; no first-revision ON run was attempted.

The [revision note](../../experiments/m3b-alias-smc/V2.md) changes owner freshness
to an ON-only requirement. The actual V2 guest ELF and rootfs are byte-for-byte
identical to V1. The compiled fused owner covers both A and B, so the ON
requirement remains strict. Both ADD and SUB pass the actual guest build's
shape probe. The source freeze retains twenty fixture files and 701
dependencies. Six fixture tests, thirteen JS syntax checks and four Python
AST checks passed; the four-file Python reviewer passed seven test methods
including physical-page, opcode, arithmetic, owner, service and protocol
corruption.

There was exactly one fresh revised OFF and one revised ON capture, with
thirty-minute deadlines. The builder was stopped before capture, owned Chrome
cleanup passed afterward, and raw stream bytes were fsynced before ACK.

## Remaining scope

This closes the bounded **between-call alias invalidation** case. It does not
exercise a store inside an active fused body, suspended-owner invalidation,
or natural interrupt delivery. Complete intermediate architectural state and
uninstrumented resource/performance acceptance also remain open. M3b is still
partial and default off. These diagnostic runs establish no speedup or
deoptimization under uncontrolled host load. The earlier timing pilot and
exactly two requested repetitions remain complete; no extra timing set ran.

The later [natural guest signal pair](m3b-natural-signal-01.md) establishes
precise saved integer contexts and resume during positive compiled workloads.
Exact native B-poll attribution and full intermediate XSTATE remain open.

Follow-up: the [interrupted-call alias pair](m3b-signal-alias-01.md) subsequently
combined natural guest signal contexts with handler writes to the later loop
block. Exact mixed-operation results and nine compiled replacement generations
passed; active generated-frame and Asyncify-suspended-owner mutation remain
outside that scope.
