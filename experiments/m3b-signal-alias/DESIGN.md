# Guest signal handler changes later-loop code during an interrupted call

Combine the accepted natural timer-context and shared-alias mechanisms. Use the
already built, source-bound code-attribution diagnostic runtime; no native code,
guard, service, countdown, cap, or production-default change is needed.

Map one private memfd page at RX 0x20000000 and RW 0x21000000. Require actual
present unswapped pagemap entries with the same nonzero physical frame at every
gate. The initial 17-byte ADD sentinel and complete GPR trampoline are the
accepted fixtures. One 100,000-iteration warm call precedes eight fixed calls
of 1,000,000+1009*i iterations with the existing varied step and register seeds.

Each measured call arms one ITIMER_VIRTUAL timer for 10,000 guest-user CPU
microseconds. The first actual SIGVTALRM/SI_KERNEL handler copies the saved
sixteen GPRs, RIP and RFLAGS without changing ucontext. It copies both alias
spans, changes only RW opcode byte 9 (ADD 0x01 to SUB 0x29, then back on the
next case), and copies both spans afterward. The handler makes no host call,
injected exit, native mutation request, or synthetic suspension. Exactly one
signal and one patch are required per call; extra/outside/late signals fail.

Saved PC must be one of offsets 4, 7, 9, 11, 14 with 4096<=RCX<n. Check all
saved registers and exact RF-inclusive flags against the old ADD/SUB operation
and progress. Require the final accumulator to equal saved EAX plus/minus the
new step for every remaining arithmetic operation. At offset 11, the current
old operation has already executed but its decrement has not, so remaining
new operations are RCX-1; all other allowed offsets have RCX remaining. Check
all preserved GPRs, final counter zero and exact final RFLAGS 0x246.

Keep all census watches disarmed so multiple normal descriptor generations
cannot be conflated into a first-tuple census. The fixed formation-byte bank
must reconcile every global fused compiled/TCI attempt at every gate with no
overflow, unmatched entries or errors. ON warmup must bind an ADD owner with
positive compiled exposure. Each signal call must execute the previously
warmed generation before the patch and a newly bound generation with the new
bytes afterward, both with positive compiled attempts, the same actual PC and
physical page, and an increasing generation. Older target generations must
stop accumulating after replacement. OFF requires exact guest arithmetic and
contexts and zero fused activity; no exact-PC ordinary-compiled claim is made.
Require zero global TB flushes and exact B/service equality under cap 12,000.

Ten gates (layout, warm, eight signal results), exactly one OFF and one ON, no
automatic retry. Thirty-minute capture and thirty-five-minute controller
deadlines remain fixed. Freeze source/build/test dependencies and verify a
checkpoint before captures; retain every failure, raw stream before ACK, owned
browser cleanup, separate JS/Python reconstruction, aggregate and checkpoint.
All scratch is under defuss-vm/tmp. No timing comparison or promotion.

This concerns an interrupted guest call. The generated native/WASM function
has already exited before Linux invokes its signal handler. It does not prove
a store concurrent with an active generated-WASM frame, invalidation of an
Asyncify-suspended owner, exact private B-poll delivery, or complete intermediate
FP/XSTATE preservation. Those boundaries remain separate gates.
