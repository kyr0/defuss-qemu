# M1 bounded execution diagnostics

This overlay adds phase-resettable PC/edge exposure to the retained amd64
runtime without modifying `engine/qemu` or `runtime`. It is an experiment,
disabled by default, and is not a performance candidate. Keep three controls:
the retained runtime, this binary with diagnostics disabled, and this binary
with diagnostics enabled. The disabled build still has extra header fields and
branches; compare it with the retained runtime separately.

**AOT and translation-plan installation are unsupported.** The separate AOT
install path does not populate the added header metadata. Revision1 rejects
its entries as unknown. Use the ordinary Bun launcher with those features
disabled; the M1 harness also rejects requests to enable them.

The first retained diagnostic candidate conservatively omitted every PCREL
TB. Actual Linux amd64 execution uses PCREL by default, so its successful
workload runs had no PC/edge attribution. Those source/build/results remain
immutable. The current candidate adds the target-specific entry-PC resolver
described in [PC-SEMANTICS.md](PC-SEMANTICS.md), with `pcAddressingRevision=1`
reported from reserved ABI header word18. Revision0 reports remain readable
and explicitly describe their lack of PCREL coverage.

From `defuss-vm`:

```sh
python3 experiments/m1-profile/test.py --report artifacts/m1-profile-native.json
python3 experiments/m1-profile/prepare.py --output artifacts/m1-source-01/source
# Using the existing pinned SDK wrapper, serialize this with all other builds:
python3 scripts/build.py --source artifacts/m1-source-01/source --output artifacts/m1-build-01 --targets x86_64-softmmu
```

`prepare.py` validates every source anchor before writing, refuses to overwrite
an existing output, copies the complete source tree, and records before/after
hashes in `source-m1-overlay.json`. No original source files are edited. The
build command runs inside the pinned SDK using the usual `scripts/sdk.py`
wrapper; it is shown separately here to make the source/output arguments clear.

The actual host-native fixtures use ASan and UBSan and test classification,
sampling, reset, bounds, collision replacement and estimate bounds, edge gaps,
counter saturation, syscall histogram bounds, and the C/JS ABI roundtrip. They
do not substitute for a QEMU build and guest execution. On this host the current
linker cannot read the selected SDK27 TBD architecture names; `test.py` selects
the already installed SDK15.4 when available, and reports that choice.

## Stopped-VM API

```js
import { resetM1Profile, readM1Profile } from './reader.mjs';
// Pause the VM and await the monitor's stopped acknowledgement first.
resetM1Profile(mod, true, 64);
// Resume, release the guest phase gate, wait for its completion, then pause.
const report = readM1Profile(mod);
// Save the report before resetting for the next phase.
resetM1Profile(mod, false, 64);
```

The exports are `_defuss_m1_abi()` (1), `_defuss_m1_reset(enabled, period)`
(0 success, -1 invalid arguments), and `_defuss_m1_data()` (memory64 pointer).
Use the reader instead of duplicating offsets. Reset and read are allowed only
after **all vCPUs are stopped**, including initialization. They are not a live
sampling API; 64-bit counters consist of two single-writer 32-bit words.
Unsupported additional worker observations are reported; such a run cannot
support attribution claims. Only one vCPU is supported in this experiment.
Keep phase names, host monotonic timings, runtime/source hashes, and guest
protocol evidence in the enclosing harness report.

## Meaning and bounds

Report storage is fixed at 217,552 bytes, with 1,024 PC slots, 2,048 edge slots,
42 64-bit aggregate counters, and a 512-entry syscall-number histogram.
An additional 40 bytes hold the previous observed key and sampler phase.
No allocations occur in the recorder. Table work scans at most four entries.
Aggregate counters count every observed event. Sampling selects every Nth TB
entry for the tables, where N is configurable from 1 to 65,536, default 64 in
the reader. This deterministic sampling can alias a regular loop: it does not
justify a random-sampling confidence interval or unqualified extrapolation.
Sensitivity runs with a different period can reveal some aliasing.

Each table bucket uses four-way Space-Saving replacement. `samplesEstimate`
is an upper bound and `samplesEstimate - samplesError` a lower bound on the
represented key's true **sampled** frequency. A replaced key can be absent;
absence is not zero exposure. Bucket collisions and replacements are reported.
This is an approximate bounded census, not a guarantee of the global top-k.
All counters saturate instead of silently wrapping. The sticky saturation flag
invalidates ordinary estimate-bound interpretations. Integers above 2^53 are
returned as exact decimal strings by the reader.

Keys contain guest entry PC, entry-time raw x86 CR3, translation
flags, compile flags, tier, and privilege category. They never contain a TB
pointer. Reuse of a TB allocation therefore cannot reuse an old identity.
Different code generations at the same address/context are intentionally
aggregated: neither these keys nor CR3 establish executable or process identity.
Keep existing TB invalidation/flush, translation, emitted bytes/instructions,
and JIT-install counters alongside the report. Use verified maps/code bytes
before naming a PC Bun, libc, JSC-generated code, or a particular algorithm.

The metadata is initialized in `tcg_gen_code` after the header exists and before
the translated block is published. For x86 PC-relative TBs, the current virtual
entry PC is reconstructed using the exact `x86_get_tb_cpu_state` formula:
64-bit EIP alone in 64-bit code, otherwise `(uint32_t)(EIP + CS.base)`.
The page offset must match the translation-time PC; mismatches are unknown.
Non-PC-relative blocks keep the translation-time PC. Other target PC-relative
contexts and AOT replay remain unknown. The adapter classifies x86 only. Protected CPL0 is
`kernel`, CPL3 `user`, rings1/2 `other-ring`; real mode, VM86, and SMM/unknown
remain separate. ARM is unknown and is not validated by the amd64 experiment.

An entry means entry into a compiled function or an interpreted TB, including
direct interpreted chaining. It does not imply completion or a number of
executed guest instructions. Faults can leave part of a TB unexecuted.
Compiled internal same-TB loops and interpreted internal bytecode branches
are invisible. Edges join adjacent observed entries only within one
`tcg_qemu_tb_exec` chain. A return/reentry, fault, unknown PC, or phase reset
breaks that chain. Consequently the tables omit some true guest edges and do
not form a complete guest control-flow graph. No claim is made that every
edge crosses JavaScript: the regular dispatcher is compiled C/WASM.

`admissionCalls` counts calls to the existing hotness/admission function, not
module compilations. Its `Ready`/`Cold`/`Held` outcomes partition those calls.
`Ready` includes already-hot/internal-chain checks and deferred retiering.
`instanceInstalls` counts successful installs; `instanceBudgetRejects` records
the distinct reservation rejection path. `dispatchIterations` counts outer
dispatcher turns; it excludes internal interpreted chains. Privilege counters
partition observed entry counts by tier, not elapsed CPU time.

The syscall histogram records x86 SYSCALL helper entry attempts after the SCE
check and before the privilege transition, restricted to long-mode 64-bit CPL3.
Other modes and numbers outside 0..511 have separate counters. These are raw
numbers without an assumed OS ABI; classify them as Linux only with the known
Linux guest identity. INT80, SYSENTER, completion/error results, blocking,
descheduling, and syscall duration are not measured. A count cannot establish
that HTTP time belongs to waiting or networking.

## Timing and perturbation

This overlay adds **no execution timers**. A clock around `call_wasm_tb` can
include Asyncify suspension or misrepresent reentry, so no new duration is
claimed without a separate suspension-aware design. Existing stage counters
remain available: helper durations nest inside interpreted/compiled execution,
emission nests inside translation, admission pressure interpretation is a
subset of interpretation, and compile/instantiate are distinct JIT stages.
An enclosing interval may include suspension/wait. Do not sum overlapping
intervals as a wall-time decomposition. Counts are exposure evidence only.

Measure enabled/disabled elapsed ratios with independent, alternating launches
and matching guest phase gates. Preserve slow results and failures. One
diagnostic run establishes instrument operation; it does not establish a
perturbation bound or justify promoting a performance optimization.
