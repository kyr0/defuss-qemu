# M3b alias writes during an interrupted guest call

The V2 OFF/ON pair passed ten gates and nine fixed calls per arm, including
**eight natural timer-handler code patches**. Every saved integer context and
mixed ADD/SUB return state was correct. ON executed nine successive compiled
generations on the same physical code page, with positive old-generation
attempts before each patch and positive new-generation attempts afterward.
Earlier replaced generations stayed quiescent. Both arms had zero TB flushes.

The [combined validation](../../artifacts/m3b-signal-alias-v2-validation-01/summary.json)
passed 1,015 identities. M3b remains partial, isolated and off by default; this
is correctness evidence, not a performance result.

## Guest operation and precise state

The guest maps one private memfd page as RX at `0x20000000` and RW at
`0x21000000`. Raw `/proc/self/pagemap` entries prove both mappings present,
unswapped and on the same persistent physical frame at every gate: `0x137e2`
in OFF and `0x197e3` in ON. The 17-byte loop includes A at RX+4, B at RX+9 and
its backedge at RX+14.

One 100,000-iteration ADD warmup precedes eight calls of `1,000,000 + 1009*i`
iterations with fixed varied steps and all sixteen GPR seeds. Each call arms
one `ITIMER_VIRTUAL` timer for 10,000 guest-user CPU microseconds. The actual
SIGVTALRM handler records the Linux ucontext and both alias byte spans, changes
only RW+9 from ADD `0x01` to SUB `0x29` or back, then records both spans again.
It does not modify ucontext. Exactly one signal and one patch occurred per call.

Both separately implemented host models check all saved GPRs and exact
RF-inclusive flags against the old operation and instruction boundary. They
then check all final GPRs, RCX zero and RFLAGS `0x246` against mixed execution:
old arithmetic before the interrupt, new arithmetic after the patch. The model
accounts for a signal between the arithmetic and decrement instructions.
All actual ON signals were saved at A; OFF had four at A and four at B.
ON remaining iteration counts ranged from 871,684 to 884,328, inside the
predeclared `4096 <= RCX < n` window. Raw context and return values are retained.

## Exact compiled replacements

The previously accepted [code-attribution runtime](m3b-code-attribution-01.md)
is unchanged. All watches remain disarmed and no counter reset, native mutation,
forced sleep or forced collection is used. Its fixed bank binds actual admitted
bytes to each descriptor generation and reconciles every global fused attempt.
Overflow, unmatched entries, identity errors, debt errors and entry rejects
are zero.

| ON generation | Loop operation | Compiled attempts | TCI attempts |
|---|---|---:|---:|
| `0x13c7b` | ADD | 226,796 | 1,500 |
| `0x13dbc` | SUB | 993,749 | 1,500 |
| `0x13e8b` | ADD | 998,641 | 1,500 |
| `0x13ecd` | SUB | 1,002,431 | 1,500 |
| `0x13f15` | ADD | 1,001,352 | 1,500 |
| `0x13f32` | SUB | 998,395 | 1,500 |
| `0x13f72` | ADD | 1,007,837 | 1,500 |
| `0x13f83` | SUB | 1,003,932 | 1,500 |
| `0x13f9b` | ADD | 880,935 | 1,500 |
| Total | | 8,114,068 | 13,500 |

Each row has actual PC `0x20000004`, physical address `0x197e3004`, the expected
12-byte ADD or SUB body, and a distinct owner/code pointer. Per-call deltas,
including old/new counts, are in the aggregate. B attempts and service payments
both equal 8,127,555. B-request count is zero: this does not establish delivery
through the private B poll. OFF has zero fused activity; no exact-PC ordinary
compiled claim is made. Final charges are 5,220 OFF and 5,271 ON under cap
12,000. Reserved linear memory is 2 GiB; no RSS or timing conclusion follows.

## Retained failures, validation and scope

V1 OFF failed while loading a JavaScript dependency, before native startup or
guest output. The dependency was source-bound but omitted from the browser
serve list. The [failed launch](../../artifacts/m3b-signal-alias-off-launch-failure-01/decision.json)
is retained; no V1 ON ran. V2 serves that exact module and checks the complete
literal import closure during preflight and before launch, with a negative test.
Guest C/assembly and every loadable ELF segment are unchanged. The
[image comparison](../../artifacts/m3b-signal-alias-v2-image-comparison-01/report.json)
finds only a compiler temporary object filename change in the nonloaded string
table; the complete ELF and rootfs hashes therefore differ and are retained.

Both V2 captures passed on their first attempt. The frozen inspector then
rejected an outdated metadata field name, before replay. That
[inspector failure](../../artifacts/m3b-signal-alias-inspector-failure-01/decision.json)
remains retained. A separately bound corrected inspector passed both saved
captures without VM reruns. The
[Python reconstruction](../../artifacts/m3b-signal-alias-v2-review-02/review.json)
passed 839 identities, including raw stream chunks, durable prefixes before
ACK, exact guest state and generation counts. The harness passed seven Node
test methods, thirteen syntax checks and four AST checks; the Python reviewer
passed six test methods and four AST checks. These share one author and are
separate implementations, not an external independent audit.

The generated WASM function had exited before Linux invoked its signal
handler. This proves alias invalidation and correct resume during an interrupted
guest call, including its later block. It does not prove a store concurrent
with an active generated-WASM frame or invalidation of an Asyncify-suspended
owner. Complete intermediate FP/XSTATE, exact natural B-poll attribution and
uninstrumented resource/performance gates remain open. The reported host load
is uncontrolled, and the earlier timing pilot plus exactly two requested
repetitions remain complete and separate. Both browser cleanup audits passed;
source, raw evidence and the handoff are preserved in verified checkpoints.
