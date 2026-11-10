# Natural guest timer signal and intermediate integer state

Use the unchanged original ABI2 native runtime, 128 MiB TB buffer, flags 2,
hot limit 1,500 and hard instance cap 12,000. No boundary selector, injected
interrupt, extra sleep, native mutation or countdown change is permitted.

The guest maps the same seventeen-byte ADD sentinel at RX 0x20000000, warms it
with 100,000 iterations, then executes eight fixed calls with 1,000,000 +
1,009*i iterations. Each timed call arms one single-shot ITIMER_VIRTUAL timer
for 10 ms of guest process user CPU time. SIGVTALRM runs on an alternate stack,
copies the actual Linux ucontext PC, sixteen GPRs, RFLAGS and siginfo into one
bounded slot, and returns without modifying the saved context. A timer that
fires outside the loop, no timer, duplicate delivery or malformed context
fails that capture. There is no retry or timing adaptation.

The complete saved integer context is checked against the exact instruction
boundary: accumulator/counter progress, ADD/SUB/CMP flags, all preserved
registers and the active guest stack. The final full integer state must match
the independently calculated result after ordinary sigreturn. FP/XSTATE at
the signal boundary and kernel/supervisor state are outside this fixture.

Ten stopped gates retain layout, warm result and all eight interrupted results.
Only the layout gate sets the one exact-PC watch and census. Each subsequent
gate requires positive compiled exposure; ON requires the same fused owner
and matching B attempts/service payments, OFF ordinary compiled execution.
Raw serial bytes and stopped observations are fsynced before ACK, and all
observations receive offline JS and separate Python reconstruction.

This demonstrates actual natural guest signal delivery and precise integer
state in a workload with positive compiled fusion. It does not, by itself,
attribute a particular signal to a compiled versus TCI native dispatch or prove
that delivery was caused by the private B-boundary poll. Global B-request
counts are reported without that causal claim. No end-to-end timing claim.

One fresh OFF and one fresh ON capture, each with 30-minute inner and 35-minute
outer deadlines, follow actual pinned-SDK build/preflight, host corruption
checks, source freeze and verified checkpoint. Retain every failure. Serialize
builds, captures and evidence hashing; keep scratch in defuss-vm/tmp.
