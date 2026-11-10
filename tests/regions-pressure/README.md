# Ordinary instance retirement fixture

Source03 targets the remaining normal pool-lifetime gate with a separately
scoped **256MiB TCG translation buffer**. This revision has not been run.
Source02 and its failed128MiB run remain immutable: at832 generated nodes,
the global TB flush changed before any instance retirement, correctly rejecting
its sentinel proof. The main state/fault/SMC fixture under
`tests/regions` remains frozen independently. Host contract tests validate the
acceptance logic only; they are not generated-code or guest evidence.

The enabled M3 runtime uses fixed pre-vCPU hotness1500, flags3 (production
admission and REP16 enabled), one vCPU,512MiB guest RAM and the unchanged12000
instance cap. The fixed256MiB TB buffer is diagnostic correctness scope, not
acceptance of the production128MiB configuration or a memory/performance claim.
It never requests GC, changes admission during execution, changes the instance
capacity, injects metadata faults, or calls a retirement API. Existing native
settings have no getters; the report records completed preRun calls honestly.

Source02 also writes `progress.jsonl` in the fresh artifact directory. Its
header binds the verified runtime and initial inputs; each confirmed-stopped
gate is appended and fsynced by the host before validation or ACK. Records are
limited to64KiB each and206 gates. The file and its containing directory are
synced on creation. A crash therefore retains completed observations, including
a later rejected gate. These rows are explicitly partial, cannot resume a run,
and never establish acceptance without a complete immutable `report.json`.

The immutable static sentinel is an add/dec/jnz loop with an independent
32-bit multiplication oracle. After eight100000-iteration calls, its exact
loop-entry range must have selected compiled entries. The stopped warm gate
requires cumulative installs below6000, zero retirements and charged==installs.
The fixture then executes unique generated add-immediate/dec/jnz loops with
arbitrary odd immediates and the same independent multiplication oracle.
100000 iterations exceed even the production96000 admission threshold. The
code occupies768000 bytes, is generated once, then changed from RW to RX;
neither it nor the sentinel is subsequently modified or remapped.

Churn stops at the first ordinary6000-slot retirement, inspected after each
64-function batch, with at most12000 functions. Each gate records stopped QMP
status, complete M3 counters, pool occupancy, UTC and monotonic elapsed host
time. A global TB flush after sentinel warmup rejects the run. After retirement,
the sentinel watch resets and the guest revisits it up to16 times, with an
ordinary one-second guest nanosleep before each retry after the first. The
report distinguishes the requested sleep duration from observed host gate
times; the total guest deadline is20minutes, with an outer20.5minute browser
watchdog. This is correctness evidence, never timing evidence.

Source03 adds a stopped `x-query-jit` read and a second confirmed-paused status
at every gate and final stop. Raw `HumanReadableText` is preserved before gate
validation/ACK; parsed fields require one exact `gen code size used/capacity`,
`TB count` and `TB flush count` line. Input is bounded32KiB. Native flush count
must match M3 and remain unchanged after warmup. Native capacity must be above
255MiB and at most256MiB, allowing less than1MiB for the pinned runtime's
guard/highwater reservation; its exact returned value is retained and must
stay fixed. Used bytes must stay within capacity and cannot decrease without
a global flush. The existing no-flush rule is unchanged.

The native query includes TB structs and padding, unlike the cumulative
emitted-WASM counter. It traverses the TB cache and adds diagnostic work;
none of these timings can enter performance analysis. Neither occupancy
measure is native JIT resident memory. The128MiB failure is consistent with
buffer pressure after boot's large translation footprint, but its raw report
has no occupancy query/overflow call-site trace. Preserve that inference limit.

The source-level ring proof is specific to engine source04/build01:

Source02 of this fixture verifies the SHA256 of that exact build report and
its retained complete post-build source-recheck, requires their matching
source fingerprint, and hashes all seven runtime artifacts before launching
Chrome. Both x86 runtime JS/WASM identities are pinned explicitly; imported
runtime helpers must match the same reviewed build. A different ABI-compatible
runtime is rejected. The report retains the verified provenance and rechecks
these inputs after the run. The110MB source tree is not rehashed during a run;
its fingerprint is bound to the retained post-build audit.

1. `add_instance` writes the next fixed-array slot, advances the FIFO end and
   increments the cumulative install counter exactly once. With zero prior
   retirement and fewer than6000 total installs at the stopped warm gate, the
   already-selected sentinel instance occupies one of the first6000 slots.
2. `reserve_instance` reaches the ordinary12000 cap before
   `remove_old_instances` removes half of the initially full ring. Requiring
   the first observed retirement count to be exactly6000 therefore establishes
   that the sentinel's original instance was retired. Some new installs within
   the same64-function batch do not undo that inclusion.
3. No global TB flush and immutable mapped sentinel text preserve its original
   owner through that interval. Global stale-miss increments are retained as
   diagnostics but are never attributed solely to this sentinel.
4. Passing requires a new selected entry at the exact sentinel loop PC, at
   least one install after the retirement snapshot, cumulative installs above
   12000 and all pool observations bounded by12000. The latter counts require
   capacity to have been released by the existing natural-GC path; no fixture
   API can release it.

If all guest answers remain correct while the retired sentinel has no selected
entry and the pool remains fully charged, the report records safe capped
fallback. If natural selected reinstantiation does not appear within16
attempts, the result is `incomplete` (runner exit2), not a passed lifetime gate.
Errors and unmet initial ring-order preconditions fail (exit1); successful
retirement plus selected reinstantiation passes (exit0). This fixture does not
establish eviction while an exact Asyncify continuation is suspended.

The source03 C/assembly/builder bytes are unchanged. Reuse the already-built
and hash-checked guest image; no guest rebuild is required for the host/QMP
observation change. The coordinator may run after other owned work stops:

```sh
python3 -B scripts/with-tmp.py -- node tests/regions-pressure/run.mjs --runtime artifacts/m3a-build-01/runtime/x86_64 --fixture artifacts/m3-region-pressure-fixture-01 --output artifacts/m3-region-pressure-on-02
```

The runner hashes all served inputs and rejects a guest image whose recorded
build-source hashes differ from the current frozen sources. The builder hashes
the exact copied source bytes used for compilation. Use a fresh output path
for each build or run; never overwrite earlier evidence.
