# M3a one-TB execution-region experiment

This overlay connects a one-TB descriptor to the **actual compiled dispatcher**.
It is disabled by default and does not fuse blocks, retain architectural values
across blocks, alter memory lowering or establish a speedup. The existing
generated function, TCI recovery stream, helper ABI and Asyncify state continue
to execute. Source and runtime baselines remain unchanged.

Current local validation: native decision/bounds/ABI fixtures pass with ASan and
UBSan. A prepared source tree is not a successful QEMU build or a guest result;
the real fixture and application reports are separate acceptance evidence.
The source-grounded contracts are in
[the design](../../docs/decisions/m3a-one-tb-design.md).

## Build and configure

From `defuss-vm`, using fresh output names and the pinned SDK:

```sh
python3 experiments/m3a-region/test.py --report artifacts/m3a-native-fresh.json
python3 experiments/m3a-region/prepare.py --output artifacts/m3a-source-fresh/source
python3 scripts/sdk.py python3 scripts/build.py \
  --source artifacts/m3a-source-fresh/source \
  --output artifacts/m3a-build-fresh --targets x86_64-softmmu --jobs 8
```

Preparation validates all anchors before copying the baseline and writes a
before/after hash manifest. It refuses existing outputs and paths outside this
project's `artifacts/`. Serialize all builds and guests with other experiments.

```js
import {configureM3Region, readM3Region, watchM3Region}
  from './experiments/m3a-region/reader.mjs';

// In the runtime's preRun callback, before any vCPU enters the dispatcher:
configureM3Region(mod, true); // false is the same-build disabled control

// After a QMP stop and confirmed all-vCPU stopped acknowledgement:
watchM3Region(mod, 0, 0x400000n, 0x401000n);
const before = readM3Region(mod);
// Resume the fixture, await its next gate, then stop/confirm again.
const after = readM3Region(mod);
```

The C exports are `_defuss_m3_abi()` (1), `_defuss_m3_configure(0|1)`
(0 success, -1 invalid/late), `_defuss_m3_data()` (memory64 pointer), and
`_defuss_m3_watch(slot, begin, end)` (0 success, -1 invalid/running).
Watch bounds are uint64/JavaScript BigInt values. Four slots support half-open
PC ranges; zero/zero clears a slot. Each configuration resets that slot's
entry/last-PC fields. Read or change watches only while the VM is stopped.
Configuration of the execution switch is rejected after dispatcher startup.
The enabled choice and startup lock share one atomic CAS word; the public
enabled/started fields are snapshots of that word when diagnostics are read.

The isolated candidate also exports a **diagnostic test companion**, ABI 1:
`_defuss_m3_test_inject(action, slot, pc)` and `_defuss_m3_test_abi()`.
`injectM3Region(mod, 'stale-instance'|'invalid-descriptor', slot, pcBigInt)`
wraps it and returns JSON-safe action/slot/hex-PC evidence on one mutation.
It requires `RUN_STATE_PAUSED`, one explicitly stopped vCPU, one TCG context,
an enabled/started region switch, and a configured watch of at most 64 KiB
within `[1 MiB, 4 GiB)`. The exact PC must belong to one live eligible CPL3
TB with a current compiled instance. Zero or ambiguous matches are rejected.
The fixture uses static non-PIE user text; this is not a process-identity API.

The test companion traverses existing QEMU TB trees under their locks and
uses the owner's existing thread-0 instance pointer, so it does not mistake
the calling main worker's TLS for the vCPU's ring. A first pass identifies one
generation; a second revalidates and changes only the instance generation to
zero, or only descriptor validity to zero. No owner/function pointer survives
the call, no executable bytes change, and no pending fault-injection branch
is added to dispatch. The host must serialize QMP stop/inject/continue.
The return is `1` for one mutation, `-1` for an invalid state/request, `-2` for
no unique match, and `-3` if the second pass no longer finds that generation.

Dedicated cumulative counters record each injected kind and rejected request;
the last PC/generation/action are stopped-read diagnostics. Tests must separately
observe exactly one `staleInstanceMisses` or `invalidRedispatches` increment
when the fixture executes the PC again, plus correct guest state. Clearing
validity for the test is counted as injection, not an ordinary invalidation;
the later QEMU invalidation sees validity already cleared. Native stand-ins
compile this exact exported companion and test rejection/mutation boundaries;
only actual guest reports establish recovery execution.

## Engine integration and exclusions

The descriptor is embedded in `WasmTBHeader` and initialized before normal
QEMU TB publication. It names one owner and the existing owner-managed physical
code dependencies; its generation is monotonically allocated and never reset
by a TB flush. Overflow makes new metadata ineligible rather than reusing an
identity. No independent executable cache or guest-PC lookup table is added.

An existing instance slot receives that generation at installation. Enabled
compiled lookup rejects a generation mismatch and uses the original
reinstantiation path; the old instance remains subject to existing retirement
and GC accounting. Both compiled hits and fresh installs pass through the same
region entry selector. A selected entry calls the original function with the
original context and return encoding.

The initial selected path supports ordinary single-vCPU x86-64 full-system
long-mode TBs. Other targets, multiple TCG contexts, legacy modes, temporary
no-RAM TBs, translation-plan/AOT entries, and single-step/breakpoint/exact-count/
atomic-step/uninterruptible contexts use the existing path. The AOT header
producer already zeroes its complete prefix, so omitted metadata cannot be
mistaken for a descriptor. Its independent compatibility/retiering behavior
is retained, not claimed validated by this experiment.

QEMU invalidation marks the owning descriptor invalid while preserving the
existing unlinking and precise SMC machinery. The selector never deliberately
calls an invalid descriptor's function. Its defensive redispatch uses the same
`cpu_exit` and encoded `TB_EXIT_REQUESTED`/CPU synchronization contract as
`wasm44_retier`; a still-valid conflicting owner is invalidated first. No new
guest exit code, instruction-search mapping or post-helper cleanup is invented.
The normal single-vCPU lifetime prevents a translation-buffer reset while its
TB is active; tests must still exercise stop, faults and suspended continuation.

The wrapper has no after-call reference decrement or cleanup that could be
skipped by QEMU's nonlocal exception exit. The existing generated unwind bank,
`BLOCK_IDX`, `do_init`, helper recovery address and call signature are unchanged.
Same-TB loops stay inside the original function. Existing service points and
admission thresholds are unchanged.

## Diagnostics and resource meaning

Diagnostics occupy 384 fixed bytes and use saturating uint32 counters with a
sticky saturation flag. Entry counters are enabled only for the selected
experiment; publication/install/invalidation counters also describe the
same-build disabled control. They are cumulative, with no global reset API.
Entry attempts partition into selected, legacy fallback and defensive
redispatch. Fallback reasons partition the fallback count.

Watch counters prove that a **particular fixture range** reached selected
compiled entry. They use synchronized x86 EIP for PC-relative TBs, requiring
the translation-time page offset to agree, or the translation PC for fixed-PC
TBs. A mismatch is reported and excluded from watch counts. Overlapping watch
ranges can both count one entry; watches are not a partition or an instruction
census. No count establishes execution completion, CPU time or JSC tier.

Descriptor bytes are included in the existing translation-buffer allocation
and high-water checks. The existing instance array adds one generation field
per slot. Runtime diagnostics report actual descriptor/header/instance-record
sizes. The instance cap and pending-GC charges remain unchanged; no second
module is created for a region. Byte counters report **cumulative emitted
bytes**, not current resident memory. Broader regions still require separate
byte/dependency budgets and lifecycle validation before fusion.

Native tests exercise the shared selection core, rejection decisions,
saturation and the C/JS layout. They do not establish page-fault recovery,
active SMC, generated-code correctness, interrupt response or suspension
safety. Those need the actual off/on differential guest fixtures with nonzero
selected watch counts, followed by unchanged Bun/snapshot/full-system checks.
M3a alone has no expected speedup, and its bookkeeping overhead must remain
visible in any later uninstrumented comparison.
