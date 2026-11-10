# Scalar lane locals with original load width

The first lane candidate reduced Wasm instructions but the separately forced
Node/V8 optimized lowering had 460 instruction bytes versus 456 original.
Inspection found eight scalar loads instead of four i64 loads and four extra
bounds/trap sites. This is a component observation, not a measured Chrome VM
regression. Preserve v1 source, builds and diagnostics; do not reinterpret them.

This derivative keeps the original four i64 private-state loads and unpacks
each pair once into the eight i32 scratch locals. All other v1 contracts stay
intact. Repeat the exact-emitter independent oracle and native-code diagnostic
before deciding whether to spend a new full-VM timing campaign. If selected,
use new source/build/validation/plan/output labels, SHA primary, and the same
four three-arm blocks declared in DESIGN.md. V1 has not been timed or frozen.
