# RNDS2 lane representation: measured code generation

The actual C emitters were compiled into byte sinks and the resulting memory64
modules were executed against an independent two-round SHA oracle. Original,
v1 and v2 each pass 20,480 arbitrary-state cases across five pointer-alias
partitions, with unaligned addresses, dirty locals and preservation of the
complete observed memory span. These component tests stub the selector true;
whole-VM selection, fallback and guest-state tests remain a separate gate.

V1 uses eight i32 input loads. V2 retains four i64 input loads and unpacks each
pair once into eight i32 locals. The Wasm bodies have 216 / 149 / 165
instructions and 351 / 267 / 283 bytes for original / v1 / v2.

Actual Node 26.11.1 / V8 14.6 ARM64 disassembly, same small memory64 wrapper
with an unknown call-stack pointer parameter for all three arms:

| Emitter | Liftoff instruction bytes | Optimizing instruction bytes |
| --- | ---: | ---: |
| Original RNDS2 | 1672 | 556 |
| Scalar lanes v1 | 1528 | 560 |
| Scalar lanes v2, original-width loads | 1472 | 512 |

The optimizing compiler prints the label TurboFan; the checked-out function
compiler routes its Wasm compilation through Turboshaft. Both tiers here were
forced by diagnostic flags, not observed during ordinary VM execution. This
wrapper is not a full translation block; no whole-VM size or speedup follows.
V1 introduces four additional scalar-load bounds/trap sites in the earlier
Node diagnostic. V2 keeps original load width and is selected prospectively
for full Chrome VM validation and timing. V1 remains built and unpromoted,
without a VM timing conclusion.

The first Node diagnostic used a constant-zero call-stack wrapper. Keep its
results separate; the matched three-way table above uses the later parameter
wrapper and comes from artifacts/rnds2-lanes-codegen-analysis-02/analysis.json
and artifacts/rnds2-lanes-node-codegen-03/.

Chrome semantic component calls passed, but no native disassembly was obtained.
The first driver incorrectly assumed a dumpio launch option; the second used
the installed Playwright browser logger and correctly failed its missing-code
assertion. All attempts and cleanup reports are retained. No Chrome native
size or observed-tier result is claimed.

MacOS host compilation initially failed against the installed SDK27 text stubs;
fresh labeled attempts selected the installed SDK26.5. This only affects the
byte-sink host tool, not the unchanged pinned Emscripten VM build environment.
