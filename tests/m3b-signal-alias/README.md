# Signal-handler alias writes during an interrupted loop call

The [design](../../experiments/m3b-signal-alias/DESIGN.md) fixes ten gates and
eight natural timer deliveries, alternating the later loop block ADD/SUB via
a shared guest alias. Saved full integer contexts and mixed-operation return
states must be exact. The accepted code-attribution runtime must record a new
compiled generation after each patch, with prior generations quiescent.

All census watches remain disarmed. No native injection, forced sleep or GC,
cap change, retry, timing or production promotion. The generated function has
already exited before the guest signal handler runs; this is not concurrent
mutation of an active generated-WASM frame or an Asyncify-suspended owner.

Use the pinned SDK builder and preflight, retained host tests, source freeze
and verified checkpoint before one controller.py 0 capture and one 1 capture.
Keep scratch under defuss-vm/tmp and audit owned Chrome cleanup after each.
Then replay with inspect.mjs, separately reconstruct in Python, aggregate and
checkpoint. Thirty-minute inner and thirty-five-minute outer deadlines apply.
