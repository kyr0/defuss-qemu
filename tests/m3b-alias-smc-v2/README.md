# Guest alias code invalidation

Use the original ABI2 runtime, 128 MiB translation buffer, flags 2, one CPU,
512 MiB guest RAM and the unchanged 12,000-instance cap. No observer native
overlay, host mutation or injected invalidation is used.

The guest maps one memfd page RX and RW at separate fixed low addresses.
It executes eight arithmetic cases as ADD, changes only the B opcode through
the RW alias to SUB, executes the same eight cases, restores ADD through that
alias, and executes the final eight. Actual pagemap entries must identify one
present, unswapped, nonzero physical frame throughout. Both aliases' complete
17-byte code strings and all arithmetic outputs are retained at six gates.

The native watch/census banks are captured before ACK. They reset exactly
three times, at layout and the two completed patch gates, only after a confirmed
stop. Each ON epoch must show positive compiled fusion at the exact RX loop PC.
Each later ON epoch must select a new code/owner and strictly newer generation on
the same physical page, with zero global TB flush, exact guest results and
normal B/service accounting. OFF requires ordinary compiled execution and permits its unchanged separate block A to retain its generation after a B-only patch.

One fresh OFF and one ON capture are predeclared, each with a thirty-minute
deadline. There is no automatic retry or timing comparison. Same-code offline
replay and a separate Python reconstruction are required before acceptance.
The new sources have one author, so they do not imply external independent
source review.

This covers guest alias writes between calls to previously compiled code.
Active-body later-block stores, suspended-owner invalidation and precise natural
interrupt recovery remain separate gates. See the [design](../../experiments/m3b-alias-smc/DESIGN.md).

The [revision note](../../experiments/m3b-alias-smc/V2.md) preserves the initial OFF oracle failure and explains the corrected ordinary-A expectation.
