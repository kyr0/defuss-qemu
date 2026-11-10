# Real guest one-TB region differential fixture

Build the static Linux amd64 fixture inside the pinned SDK, then run the same
image with the one-TB region API disabled and enabled in separate fresh Chrome
VMs. The runner configures the API before vCPU startup, uses hotness 1500 with
admission filtering disabled for exposure, and retains the normal 12000 instance
cap. This is correctness evidence, never performance evidence.

Hotness and admission settings remain fixed for the entire run: the native
fields have a pre-vCPU configuration contract, so a QMP stop does not authorize
changing them. Source03 records the completed preRun API calls (the native
settings have no getters) and retains every stopped gate's counters and pool
occupancy, including a gate that fails exposure validation. It checks the normal
12000 cap at each gate and never forces garbage collection. The earlier
hotness-16 off01/on01 runs exhausted the pool at boot and establish no selected
fixture-code coverage; their reports and exact sources remain preserved.
Existing warmups exceed 1500, but actual selected exposure is still mandatory
at every enabled correctness gate. This diagnostic admission setting does not
establish behavior under production pressure-based admission.

```sh
python3 scripts/sdk.py python3 tests/regions/build.py --output artifacts/m3-region-fixture-01
node tests/regions/run.mjs --runtime artifacts/m3-build/runtime/x86_64 \
  --fixture artifacts/m3-region-fixture-01 --enabled 0 --output artifacts/m3-region-off-01
node tests/regions/run.mjs --runtime artifacts/m3-build/runtime/x86_64 \
  --fixture artifacts/m3-region-fixture-01 --enabled 1 --output artifacts/m3-region-on-01
```

The guest checks arbitrary-input arithmetic, all defined arithmetic flags and
SIMD lanes; 384 precise page faults with saved RIP/registers/flags and one prior
committed store; cross-page fault ordering; executable RW/RX alias invalidation;
an already compiled block modifying a later instruction in itself; asynchronous
signals delivered inside the hot loop with exact continuation checksum; and a
blocking read that retains callee-saved registers and stack data across host
delayed ACK and stop/resume. Interrupt counts are intentionally variable and must not be
compared as deterministic performance observations.

After state-function warmup, two stopped diagnostic gates target that exact
compiled user entry PC. Enabled mode first changes one live instance generation,
then clears one descriptor's validity. Each is followed by 64 deterministic
state/flags/SIMD checks. The runner requires one mutation and one corresponding
stale-instance miss or invalid redispatch. A stale instance is reinstantiated
at once and must add selected entries during those 64 checks. An invalid owner
is discarded by normal QEMU invalidation: its replacement starts cold. Source04
therefore verifies the immediate recovery at gate6, then executes 2048 further
deterministic calls and requires selected replacement entries at gate7 without
an additional redispatch. Disabled mode executes the same calls without mutation.
This requires the isolated candidate04 diagnostic API and is not a production
entry-path benchmark.

COM1 gates stop the guest before reading counters or configuring bounded watch
ranges. Enabled runs require selected entries inside the fixture's exact code
ranges, not just activity elsewhere in Linux. Separate load/store ranges and
gates14/15 establish selected exposure in each of the unmapped-load, cross-page
load and protected-store batches. The SMC simple function (page offsets0..6)
and active self-modifying function (offsets128..166) have separate required
watches. Source05 adds gates16/17 around the first actual active self-modifying
call: after compiled warmup, the active watch resets, then exactly one original
entry and an invalidation must occur. The generated function first increments
a separate 64-bit side-effect counter before writing its later instruction;
the guest requires that earlier store to occur exactly once, including across
precise-SMC recovery. Fault and interrupt watches reset after warmup to require exposure
during the actual fault/interrupt stages. A
separate libc-read gate resets the suspend watch after warmup; only the final
checked assembly read call can then contribute to that watch. The host delays
its ACK for 100 ms while the guest is running and verifies final selected entries
after the call returns. This proves guest syscall/register/stack continuation;
it does not identify an Asyncify unwind inside that selected function or prove
eviction while such a continuation is suspended.
Raw reports retain gate order, module identities, fixture/source hashes and all
region counters. No host-only model or compiled build can substitute for these
live reports. More demanding stale-link eviction and suspended invalidation
coverage may still be needed as region behavior expands.
