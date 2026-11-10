# Guest alias writes invalidate a warmed two-block owner

Use the unchanged original ABI2 diagnostic runtime. This next gate targets
ordinary guest code-page invalidation through an alias, between calls to an
already compiled owner. It does not claim a store inside an active fused body,
an interrupt handler modifying a later block, or suspended-owner invalidation.

The guest creates one private memfd page and maps it twice with MAP_SHARED:
RX at 0x20000000 and RW at 0x21000000, using MAP_FIXED_NOREPLACE. The executable
bytes are the accepted 17-byte pressure sentinel including prelude and return.
The watched A PC is RX+4, B is RX+9. Reads from /proc/self/pagemap must show
both pages present, not swapped, with the same nonzero physical frame. Both
aliases' actual code bytes and raw pagemap entries are retained. Unsupported
pagemap access or missing PFNs fail; no inferred physical identity substitutes.

Execute the fixed eight-case arithmetic vector in three epochs: original
ADD, SUB after writing only opcode 0x29 through RW+9, then restored ADD after
writing 0x01 through the same alias. Include zero, short and hot iteration
counts, with independently calculated uint32 results and varied step values.
All writes occur after the previous invocation has returned. The first epoch
must have positive compiled exact-PC exposure before any patch. All later ON
epochs must again have positive compiled fused exposure, changed code/owner
generation, unchanged guest physical code page, no global TB flush, exact
arithmetic, and normal B/service equality. OFF uses ordinary execution as a
correctness control.

Six guest gates: layout, add-complete, sub-patched, sub-complete, add-patched,
add-restored-complete. Watch/census epochs reset only at layout and the two
patch gates, after the old raw banks and guest bytes are durable and the VM is
confirmed stopped. The actual code store is entirely guest-driven; no native
injection API, mutation-guard bypass, cap change, countdown change or forced
collection. The original runtime source/build/binding remain immutable.

Freeze the fixed work and source closure before exactly one OFF and one ON
capture. Each gets the already authorized 30-minute capture deadline. Retain
failed/incomplete outcomes without automatic retries. Raw serial and stopped
banks are fsynced before interpretation and ACK. Separate Python replay must
reconstruct the arithmetic, gate order, alias bytes/physical identity and
owner transitions before acceptance. No timing comparison or performance claim.
All scratch remains under defuss-vm/tmp.
