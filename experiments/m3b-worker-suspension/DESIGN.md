# Real vCPU-worker service suspension observation

This next diagnostic extends the original ABI2 runtime in a fresh source tree.
The admitted integer generated function has returned before
`m3b_service_after_call` can call the unchanged `trysleep`. The experiment must
therefore identify the suspended native dispatcher/service continuation; it
must not call that a still-active generated-WASM function.

Retain the existing 50,000-turn decrement/reset, full-capacity sleep predicate,
12,000-instance cap, guest work bounds and normal GC behavior. No new sleep,
countdown write, forced GC, capacity bypass or production-default change.

A bounded native observation bank will open a candidate only when an actual
fused return has positive service debt, the existing countdown is one and the
normal pool predicate is full immediately before payment. The caller supplies
the actual entry owner, PC and compiled/TCI route. A local owner identity is
saved before the existing generated/TCI call; no observer pointer is used for
execution. The original service function remains byte-identical.

The bank retains at most four candidates, scalar owner/generation identity,
exact before/after GPR/native lazy-flag/control fields, the owning pthread,
service debt and native B-attempt/service/request counters. The original
service clears debt and accounts before sleep. The observed four transitions
must be native 0->1,1->0,0->2,2->0, with zero debt, exactly one paid B attempt,
and the same worker identity at every event. After the original helper returns,
the native endpoint validates state preservation and completed accounting.
Raw state field equality is not a substitute for complete intermediate XSTATE
or precise natural-interrupt semantics.

A separately derived runtime JS file will capture raw Asyncify getters and the
new global-bank address before export wrapping. It records the real pthread
pointer from the existing worker run message after thread initialization.
Only that worker may write transition rows while its native candidate is active.
No wrapped native export may be called during unwind/rewind. The observer calls
each original transition exactly once and preserves its return/exception.
Other worker transitions are ignored. The observer introduces no yield.
Native and derived JS bytes must be bound separately; all other runtime assets
remain exactly the actual native build output.

A fixed pressure fixture is required: the ordinary Bun and small correctness
runs do not reach the 12,000 charge cap. The existing pressure fixture puts the
sentinel among the first retired owners; a new fixture must deliberately warm
a sentinel in the later half of the normal FIFO ring before filling the cap.
It can then execute the retained compiled fused owner while natural capacity
is full. Selection of an inner-service versus outer-dispatch sleep depends on
the unchanged countdown. Use a predeclared finite number of fill/revisit cycles;
retain an incomplete result if no required actual episode occurs. No retry or
threshold adjustment may convert it into a pass.

First acceptance is actual owning-worker continuation with exact state and
single service payment. Suspended-owner invalidation is a subsequent, separately
specified test; it must not call existing stopped-only mutation APIs while the
VM is running or weaken their guard. Natural interrupt/alias-SMC and performance
gates remain open. Same-agent host tests and source review are not external
independent validation. All scratch is under `defuss-vm/tmp`.
