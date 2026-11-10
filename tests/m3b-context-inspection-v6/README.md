# Bounded offline dependency replay

This isolated inspector preserves every host-v5 capture, oracle, trace-window,
census, terminal, and guest check. It permits only canonical historical artifact
`native-trace.log` dependencies with an exact SHA256 and byte identity to exceed
the generic 128 MiB allocation limit, up to the existing 512 MiB total trace cap.
The complete bytes are still read and hashed. Explicit metadata caps and the
128 MiB parsed-window cap remain unchanged. Source equivalence is tested.

The result retains the host-v5 semantic replay kind and explicitly binds this
new inspector's frozen source and independent review in metadata and inventory.
Run only after the capture browser has closed. It does not retry guests or make
performance claims. The original failed offline inspection is preserved.
