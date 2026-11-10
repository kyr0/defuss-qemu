# Natural guest signal fixture

The [design](../../experiments/m3b-natural-signal/DESIGN.md) fixes one warm call
and eight one-shot virtual CPU timers during the same warmed ADD loop. Actual
Linux signal ucontexts retain all sixteen GPRs, PC, flags and signal provenance;
full final integer state is checked after ordinary signal return. One layout
watch epoch and ten gates bind each call to positive compiled exposure. This
alone does not attribute the exact delivery to a native compiled/TCI dispatch.

Use the pinned SDK build, preflight, retained host tests, source freeze and
verified checkpoint before `controller.py 0` and `controller.py 1`. Each capture
has a 30-minute deadline. Raw bytes precede ACK; inspect saved results and use
a separate Python reconstruction. No timing acceptance, injected interrupt,
forced GC, loop retuning, implicit retry or native-boundary override.

Revision 2 requires the exact RF-inclusive saved flags of the pinned original
QEMU interrupt path. See [revision evidence](../../experiments/m3b-natural-signal/V2.md).
