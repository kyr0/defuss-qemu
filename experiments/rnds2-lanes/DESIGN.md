# RNDS2 scalar lane locals

Prospective successor to the inconclusive RNDS2 SIMD setup screen. This
candidate starts again from retained RNDS2, with no setup, M2 or M3 changes.
The checked-out V8 baseline compiler emits the supplied scalar operations;
our packed i64 state repeatedly requires shifts/wraps and packing. Eight i32
scratch locals can express the two rounds directly. This is a hypothesis,
not an assumption of actual tier or end-to-end gain.

Only the backend emitter changes. Generic argument ABI, helper selection,
TCI code, clobbers, guest memory translation and admission limits stay intact.
Append eight i32 locals only to TBs that emit RNDS2; preserve locals 0–20,
including the resume cursor. Reset the translation flag at every TB start.
All eight words are initialized inside each pure intrinsic. No helper call,
unwind or side exit exists inside it, so no new resume state is needed.
Read both input vectors before writing the destination, preserving aliases.
Cache the private destination pointer after reading both inputs. The scalar
round equations and destination write order remain unchanged.

Before full-VM timing, validate the actual extracted emitter byte streams
against an independent scalar oracle over aliases and dirty scratch state;
then boot the production runtime with the retained RNDS2, SIMD setup and
PSHUFB fixtures and the unchanged Bun package. Any diagnostic counters belong
in a separate build/run. Do not treat a component speedup as a VM speedup.

If advancing to VM timing, freeze a new four-block three-arm campaign using
the same retained original and matched unchanged rebuild as the setup study,
but fresh launches for every arm and a new candidate runtime. SHA-256 is the
primary metric. Report all other workloads, readiness and full horizon, keep
every sample, use the same settings/deadlines and paired log intervals.
No promotion without a repeated gain and resource/correctness acceptance.
