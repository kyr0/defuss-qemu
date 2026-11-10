# M3b unchanged Bun cold exposure

This isolated diagnostic uses the frozen ABI2 runtime and original M1 Bun bundle,
kernel and initramfs. It runs all 69 original gates and 12 workload results with
hot limit 1500, runtime flags 3, one CPU, private 512 MiB RAM, and a 128 MiB TB
buffer. The fixed guarded machine disables ACPI, HPET, USB and VAPIC; its graph
must match the already bound native contract before vCPU startup.

The original guest readiness message receives `C` after a durable paused
observation. No snapshot is captured or restored: migration is prohibited by
this experimental profile. Guest source and filesystem bytes are unchanged.
One OFF run and one ON run execute serially, each with a 30-minute operational
deadline. This is a new correctness/exposure check, not another timing pilot.

Each raw 96-word M3a, 128-word M3b and 2400-word census bank, plus the serial
segment, is fsynced before the host oracle can authorize the next ACK. No watches,
counter resets, metadata injections, trace logging, or forced GC are used.
Census watches remain empty; the observation therefore establishes only global
execution during phase windows, including kernel and gate work. M3b entries
are attempts, not retired bodies. The final complete report and offline replay
are required for acceptance; a partial journal is not a completed run.

The loader revalidates the frozen native build/source binding, serves only bound
bytes, archives all listed harness sources in each fresh capture directory, and
rehashes inputs after execution. Old captures and source freezes are untouched.
The same-code offline inspector does not constitute an independently authored
review. Every elapsed time is diagnostic and ineligible for performance claims.
Full XSTATE, natural interrupt/alias SMC, and owning-worker suspension coverage
remain separate open gates. The candidate remains off by default.
