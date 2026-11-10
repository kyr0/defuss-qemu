# Idle-host comparison against the retained RNDS2 baseline

New work follows the user's 2026-11-08 request to measure with unrelated host
load reported zero. Read DESIGN.md for the prospective protocol. No older
loaded FIFO observation is reused, discarded, or reclassified.

`prepare.py` makes a fresh five-file derivative of accepted ABI2 source. The
native source does not include the newer code-attribution observer. It removes
M3a/M3b diagnostic updates and scans, context census and the forced-boundary
IR selector. Actual native pending checks, service payments, fixed bounds,
metadata layouts, graph pinning and entry guards are retained. The original
accepted implementations and observations remain unchanged. The overlay
records exact before/after files, full fingerprints and preserved functions.

`benchmarks/harness/m3b-timing/freeze.py` checks the completed build against the
accepted SDK/settings, rechecks both complete source trees, checks actual WASM
exports for diagnostic absence, runs protocol/timing checks, archives sources,
and writes the twelve-launch plan exclusively. `campaign.py` serializes fresh
Chrome launches and checks the compiler VM before/after each. An fsynced
journal precedes every guest ACK. It checks cleanup before the next launch.
A failed or unfinished attempt is retained and halts; successful completed
steps can be adopted on a restart only with matching plan/inputs and cleanup.

`analyze.py` independently reconstructs the elapsed arithmetic and guest result
checks from raw journals, replays the strict JS protocol, verifies source and
runtime identities, and reports every matched launch. This is same-author
cross-implementation verification, not external independent review.

The output is experimental cold timing. M3b remains default off. This experiment
does not enable snapshots, relax graph restrictions, integrate MSG1/MSG2 or FIFO,
repeat native smolvm timing, or establish a production promotion. Runtime ON/OFF
means the requested configuration; prior diagnostic exposure evidence is
separate from uninstrumented timing, where hot-path execution is not counted.
