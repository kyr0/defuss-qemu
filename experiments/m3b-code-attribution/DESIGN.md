# Bind actual fused entry attempts to the bytes translated in this run

Use a fresh observation-only derivative of the original ABI2 tree. Keep the
original admission predicates, IR, descriptor layout, guards, service helper,
countdown, pool policy, capacity and default-off selection byte-identical.
Only add a fixed bank and two observation calls: after successful completed
fusion formation, and at the existing compiled/TCI tier accounting point.

At formation, copy at most the exact admitted 128-byte first-page span already
read by the original predecoder, with owner pointer, actual translation PC,
physical pages, flags, cflags, length, B offset and translation CR3. Retain the
first sixteen formations; count overflow and refuse attribution acceptance if
any occurs. No guest memory is read on the execution path.

At the existing tier accounting point, bind the actual descriptor generation
and code pointer to the most recent matching formation of that TB owner. Check
translation PC, pages, flags, cflags and shape against the published descriptor.
Count every actual compiled/TCI fused attempt per bound generation and globally.
Record first/last entry PC and CR3, requiring the bound PC and one CR3 per row.
A repeated owner address must bind a new formation, never silently reuse an old
generation. Unmatched entries and overflow are retained and fail acceptance.
Observation errors only set bank flags; they never alter guest execution.

A fast last-code/generation cache may skip a linear slot search, but formation
must invalidate it and every selected entry must check the exact immutable
identity. No guest functions, instance objects or TB lifetimes are retained.
The bank stores scalar addresses and bytes only and is read only while stopped.

One cold OFF and one cold ON capture execute the unchanged M1 Bun package,
69 gates and 12 result batches, with the same 30-minute deadline. No automatic
retry on zero exposure or other failure. Sum per-generation tier deltas must
exactly equal the original global counters at every stopped gate. Disassemble
captured bytes offline and run the unchanged predecoder over each exact shape.
Tie phase exposure to these generations. Existing process maps are only a
named-gate association; do not infer process identity from CR3, JSC tier, source
function name, exclusive cost, retired bodies or a historical code generation.

Before captures: plain and ASan/UBSan observer models, corruption tests, complete
source inventory and symlink audit, actual pinned SDK build, artifact binding,
source-stable harness tests and verified checkpoint. After captures: owned
Chrome cleanup, byte/source-bound offline JS and separate Python reconstruction,
combined review, docs and a verified checkpoint. All scratch stays under tmp;
serialize heavy jobs. These instrumented runs are ineligible for timing claims.
