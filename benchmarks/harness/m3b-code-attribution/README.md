# Current-run fused code attribution

The [design](../../../experiments/m3b-code-attribution/DESIGN.md) adds only
formation-byte and per-generation tier observations to an isolated native copy.
The unchanged Bun M1 package performs all 69 gates and 12 result batches. The
host reconciles every per-generation count with original global counters and
rejects storage overflow, unbound entries, resets or changed code identities.

One cold OFF and one cold ON capture; no retry on zero exposure. A successful
workload with zero enabled compiled entries has attributionAccepted=false.
Process maps are associated only with their named gate; do not infer a JSC tier,
source function, process from CR3, historical code generation or time fraction.
Native descriptor and instance lifetimes are unchanged. No guest memory read
is added to the execution path. No timing/promotion claim.

Run only after the actual native build/binding, retained host checks and source
freeze/checkpoint. Use controller.py 0 then 1 with owned Chrome cleanup between
runs; inspect saved bytes and separately reconstruct them in Python afterward.
All scratch is under defuss-vm/tmp; the capture deadline is thirty minutes.
