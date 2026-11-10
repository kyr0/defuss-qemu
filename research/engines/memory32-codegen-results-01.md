# Memory-addressing component diagnostic

The actual retained RNDS2 emitter and actual pointer-normalization function
were extracted and compiled with and without WASM64_MEMORY64_2. No RNDS2 math
was recreated in the byte sink. The selector is stubbed true; this is not a
whole-TB or selection test. Both outputs passed 20,480 arbitrary-state checks
with five alias partitions, unaligned addresses, dirty locals and independent
two-round oracle/full 192-byte memory comparison.

| Body / native instruction bytes | Memory64 | Memory32 address profile |
| --- | ---: | ---: |
| Wasm instruction count | 216 | 234 |
| Wasm body bytes | 351 | 369 |
| Node V8 forced Liftoff instruction bytes | 1672 | 1424 |
| Node V8 forced optimizing instruction bytes | 556 | 344 |

Both native code diagnostics use the same unknown call-stack pointer parameter,
shared 64 KiB memory, original local layout and a checked result. They use
nondefault forced-tier flags and are untimed. They do not establish full-TB
sizes, default tiers, Chrome codegen or an application speed gain. The emitted
pointer wraps add Wasm operations while the lower address width allows V8 to
remove memory64 reservation checks; the exact disassembly is retained.

Evidence: artifacts/memory32-rnds2-emitter-01 and
artifacts/memory32-rnds2-node-codegen-01. Full guest correctness and cold paired
application timing are separate, pending at the time of this report.

Chrome and Node are materially different references here. The newer checked-out
Chrome V8 uses an extra guard page on ARM64 to compare small-offset memory64
accesses against a power-of-two reservation boundary (Turboshaft graph interface
8258 onward). The measured Node disassembly instead materializes offset-adjusted
64-bit constants. Therefore its code-size reduction must not be projected onto
Chrome, even for this same intrinsic; the actual Chrome guest measurements
remain the decision evidence.
