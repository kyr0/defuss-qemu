# defuss-vm

WASM-only QEMU consolidation for x86-64, x86-32, and ARM64 guests. This is the
working baseline for the architecture in [PLAN.md](PLAN.md), not the proposed
region compiler or Linux application personality yet.

M0 consolidation is complete. M1 work adds an isolated diagnostic runtime,
[phase harness](benchmarks/harness/m1/README.md), and
[standalone integer/SHA references](benchmarks/wasm-reference/README.md).
The diagnostic build is an attribution tool; it does not replace the retained
runtime or establish an application speedup.

The interrupted M1 campaign has been resumed and independently verified; see
[current implementation status](docs/IMPLEMENTATION.md) and
[pilot 02](docs/decisions/m1-pilot-02.md). New work includes
[crash-resumable serial campaigns](benchmarks/harness/campaign/README.md) and
[bounded stopped code inspection](benchmarks/harness/code/README.md).

The resumed implementation now includes exact SHA256MSG2 lowering and an
experimental one-TB region path. MSG2 passed instruction, held-out snapshot and
production-workload exposure checks, but its independently reviewed
[sustained experiment](docs/decisions/m2-msg2-sustained-v2-01.md) failed performance
selection. The region path passed real compiled state, fault, stale/invalid
recovery, self-modification and continuation checks. A separate pressure test
passed FIFO retirement and natural-GC reinstantiation with a fixed 256 MiB
translation buffer. The original 128 MiB pressure attempt remains a failed
no-flush proof. A separate MSG1 lowering passed native/emitted-WASM tests and
all four exact-count hot/cold off/on instruction runs. Its unchanged-Bun
off/on exposure captures, comparison and independent evidence review also
[passed](docs/decisions/m2-msg1-exposure-01.md). The passive FIFO pool-policy candidate passed its
held-out, combined architectural and cumulative module-input byte checks.
Its first finite timing set is incomplete after a deadline failure under
user-reported heavy host load. Both requested additional four-pair sets completed
and passed independent evidence replay. Their full-horizon candidate/control
ratios are 1.582 and 1.438; these loaded observations establish no causal
deoptimization or performance gain. The [three-set report](docs/decisions/passive-fifo-load-affected-repetitions-01.md)
retains every completed pair and the original failure. The isolated
[M3b two-block experiment](experiments/m3b-fallthrough/README.md) has built and
passed a real OFF/ON boundary pair, including four compiled native state/service
probes and independently verified device/RAM controls. A standalone Asyncify
contract also passed two real unwind/rewind episodes. The new census-bound OFF/ON pair passed all 45 gates and 943,364 checks
per arm, including all 12 enabled body-accounting windows. An
[independent replay](artifacts/m3b-context-v2-baseline-review-01/review.json)
verified 1,111 identities. Earlier failed captures remain failed; the
[source and evidence record](docs/decisions/m3b-census-validation-01.md)
explains the bounded corrections. Typed recovery also passed both complete 45-gate runs and independent replay.
A separate bounded pressure pair passed 112 gates and 6,987 checks per arm,
including compiled fused-owner reentry after retirement and natural capacity
release with a fixed 256 MiB translation buffer. The
[combined validation record](artifacts/m3b-census-validation-01/summary.json)
binds all three independent results. A new
[unchanged-Bun cold pair](docs/decisions/m3b-bun-exposure-01.md) passed 69 gates
and 12 workload results per arm, but recorded zero two-block formation or
execution throughout the enabled run. A subsequent
[admission diagnostic and original-runtime confirmation](docs/decisions/m3b-bun-admission-01.md)
passed the same workload and separate offline reconstructions, with 76.7 million
and 76.6 million compiled fused-entry attempts in warmup and integer phases.
Positive Bun exposure is now observed; the earlier zero result remains retained
and its cause is unresolved. A further
[extended-state OFF/ON pair](docs/decisions/m3b-xstate-preservation-01.md)
passed all 47,168 calls per arm, including every enabled user XSAVE component
(x87/SSE/YMM/MPX) and twelve positive measured fused windows.
The later [owning-worker suspension pair](docs/decisions/m3b-worker-suspension-01.md)
passed four recorded compiled-sentinel service continuations, all sixteen native
unwind/rewind transitions, exact captured state and single service payments.
The generated function had returned before each suspension. The subsequent
[guest-alias SMC pair](docs/decisions/m3b-alias-smc-01.md) passed all 24 arithmetic
checks per arm after ADD/SUB/ADD writes to B through a shared physical alias.
ON replaces the fused A+B owner after both writes, with no global TB flush.
This establishes between-call invalidation. The subsequent
[natural guest signal pair](docs/decisions/m3b-natural-signal-01.md) preserved all
sixteen saved GPRs, exact interrupted flags and full resumed integer state for
eight actual virtual timer signals per arm, with positive compiled exposure. The subsequent
[current-run code attribution pair](docs/decisions/m3b-code-attribution-01.md) binds
76,136,449 compiled and 108,032 TCI attempts to three exact descriptor generations
and their identical 40-byte integer-loop bodies. All per-phase totals reconcile;
measured JSON/SHA/HTTP have zero fused exposure. The subsequent
[interrupted-call alias pair](docs/decisions/m3b-signal-alias-01.md) passed eight
natural timer-handler patches per arm with exact saved/resumed integer state
and nine compiled ON generations; replaced generations stayed quiescent.
Complete intermediate state, exact native interrupt attribution, invalidation
of an Asyncify-suspended owner and resource/performance confirmation gates
remain open.
See [current status](docs/IMPLEMENTATION.md) for the evidence and remaining gates.
All candidates remain isolated experiments; none has been promoted.

The [fresh uninstrumented M3b timing comparison](docs/decisions/m3b-idle-timing-01.md)
completed twelve new matched cold launches with 14,400 checked calls. Current
ON took 18.31% more full-sequence time than the original RNDS2 baseline; integer
time was 3.6495× and JSON time 1.1980×. SHA/HTTP differences were inconclusive.
OFF also showed overhead. This documents no gain under the tested protocol;
M3b remains default off and the older load-affected FIFO sets remain separate.

Keep task scratch under `defuss-vm/tmp` using
`python3 -B scripts/with-tmp.py -- COMMAND ARGS`. Source, reports and build
outputs stay outside scratch. [Verified local checkpoints](scripts/CHECKPOINTS.md)
retain source/runtime archives, selected evidence and the current
[resume handoff](AGENT_HANDOFF.md), with hashes and durable publication.

## What is consolidated

- `engine/qemu/`: QEMU 11.1.3 with the existing WASM/Windows 98/Linux changes
  and the validated PSHUFB + SHA256RNDS2 production source overlay merged in.
- `runtime/x86_64/`: byte-identical retained RNDS2 runtime, used by default for
  Bun packaging here. The original workspace's defaults are untouched.
- `runtime/aarch64/`: byte-identical retained ARM64 runtime with guarded 1 MiB
  worker stacks and its required direct-chaining workaround.
- `runtime/i386/`: freshly built from the consolidated source and checked with
  a real/protected-mode boot fixture; this does not add an i386 Bun image.
- `packaging/`: reusable pinned TypeScript/Bun bundler and the COM1 snapshot
  launcher, using only files inside this project.
- `host/browser/`: the dependency closure for QMP, serial, PC storage/display,
  graphics, audio, and profiling; unrelated demo modules are excluded.
- `tests/`, `benchmarks/`: snapshot checks, real guest smoke runners, the
  original Bun operation sources and expected results.
- `manifests/`: per-file provenance, pruning inventory, original build records,
  and immutable runtime/asset identities.

RNDS2 is the best independently confirmed Bun candidate in the retained work.
The setup and PMAXUB screens and other isolated experiments are not silently
combined into this baseline. Its SHA improvement is workload/protocol-specific.
See [retained results](docs/evidence/rnds2-results.md) and the
[comparison report](docs/evidence/smolvm-comparison.md). Those historical reports
retain their original wording and relative references; their original complete
evidence remains in the parent workspace.

## Source pruning

The initial import retains roughly 111 MB of file contents and excludes roughly
589 MB: about 84% of the original file contents. Filesystem allocated sizes differ
because the original tree contains tens of thousands of small files.

Removed categories:

- Guest CPU implementations other than `target/arm` and `target/i386`.
- Machine implementation directories for the removed guest architectures.
- Native host TCG backends; the WASM backend and interpreter support remain.
- BSD user-mode implementation and unrelated Linux guest ABI directories.
- Large external firmware source projects and unrelated prebuilt firmware.
- Tests for removed TCG targets and upstream multi-platform CI provisioning.

ARM's shared 32-bit code remains because the AArch64 implementation depends on
it. Some removed machines' small Kconfig files remain to define symbols used
by shared device configuration. Shared headers, device models, compatibility
stubs, general tests, and Linux-user reference code remain where the dependency
boundary has not yet been narrowed safely. Windows 98 needs legacy boot,
graphics, storage, and audio behavior; these are not disposable merely because
the first workload is Bun.

This is a conservative source reduction, not a claim that every retained file
is needed by every build. A later device-level reduction should follow the
build graph and guest regression evidence. Pruning does not itself establish
a runtime speedup.

`manifests/qemu-import.json` records every imported file, its source/hash, the
RNDS2 overlays, excluded paths/reasons, and build-metadata edits. The importer
refuses to overwrite an existing tree. No symlink points back to the old source.
Firmware binaries retain their original licenses/provenance; rebuilding those
external firmware projects is outside the emulator build. The original complete
firmware sources remain in the original workspace.

## Build from source

Use Docker with the pinned SDK image already available, or allow your normal
Docker setup to acquire that exact digest first. SDK commands run offline and
mount only this project as `/project`, plus the Emscripten cache volume.
No old configured build, object file, archive, or sibling checkout is used.

```sh
cd defuss-vm
python3 scripts/verify-import.py
python3 scripts/build.py --output artifacts/example-dry --dry-run
python3 scripts/sdk.py python3 scripts/build.py --output artifacts/build-new --jobs 8
```

The default build targets are `x86_64-softmmu,i386-softmmu,aarch64-softmmu`.
Select a subset with `--targets x86_64-softmmu`. Outputs must use fresh names.
Use `--source artifacts/<experiment>/source` for an isolated source overlay
inside this project. The default remains `engine/qemu`; an output directory
inside the chosen source tree is rejected. The M1 overlay is prepared with
[`experiments/m1-profile/prepare.py`](experiments/m1-profile/README.md).
The build uses strict SIMD, memory64, pthreads, Asyncify, and guarded 1 MiB
stacks. It preserves the current 12k admission/pool behavior in the source.
It stages the JS postprocessing fixes and transitive browser runtime modules.

The source build produces new artifacts under `artifacts/build-new/runtime/`.
It does not overwrite the retained validated runtimes. Build path, target set,
and configuration can change binary hashes; the original performance result
does not automatically apply to a new build.

VERIFIED: Generated `runtime/*/qemu-system-*.js` and `.wasm` files are
gitignored; the handwritten runtime modules and identity manifests remain
eligible for version control. A fresh clone needs a new build or restored
runtime files before running the VM. Historical benchmark replay requires
the exact baseline binaries identified by `manifests/runtime-baseline.json`;
the local [checkpoints](scripts/CHECKPOINTS.md) retain those binaries separately
from Git.

For a Docker engine inside Lima, use an explicit argv array rather than a
hard-coded dependency on the old workspace:

```sh
export LIMA_HOME=/Users/admin/.defuss-vm-lima
export DEFUSS_VM_DOCKER_COMMAND='["/absolute/path/to/limactl","shell","builder","--","sudo","docker"]'
```

Keep the Lima instance in persistent storage. The former `/tmp/qw-lima`
instance disappeared during the crash. The recovered local builder and exact
image identities are described in [the build-host recovery notes](docs/build-host.md).

The SDK is pinned to
`registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812`.
The prepared DTC subproject is included for ARM64; no source download occurs.

## Bundle and run a Bun application

Guest assets are under `assets/bun/amd64/` and verified against fixed hashes.
They are local binary inputs, excluded from source control by `.gitignore`.
The pinned bundling container is ARM64 Bun 1.4.4; the resulting JavaScript is
portable, while the application guest remains Linux amd64 Bun distroless.
Your container engine must support the builder image's architecture.

```sh
python3 packaging/bundle-bun.py packaging/bun-app/example/automatic.ts \
  --project-root packaging/bun-app/example --outfile artifacts/automatic.mjs
node packaging/bun-app/run.mjs artifacts/automatic.mjs.app \
  --until AUTO_VERIFIED --report artifacts/automatic-cold.json
node packaging/bun-app/run.mjs artifacts/automatic.mjs.app \
  --until AUTO_VERIFIED --report artifacts/automatic-restored.json
```

Snapshots are enabled by default. The wrapper signals ASCII `1` on COM1 after
top-level module initialization and waits for `C/R`. Use `--snapshot-ready manual`
when the app needs its own awaited preparation point. The cache key includes
both app SHA256 and runtime/configuration compatibility SHA256. Durable capture
precedes the cold ACK. Arbitrary app buffers and external operations still need
the application's own preparation/flush contract.

Use `--runtime-dir artifacts/build-new/runtime/x86_64` to package a freshly built
candidate. It receives a different compatibility identity and cannot consume
an incompatible retained snapshot.

## Validation

The migrated browser pages and root Win98 automation are in
[e2e/](e2e/README.md). `npm run e2e:serve` serves the local test page;
`PROFILE=smoke-01 npm run e2e:smoke` boots a generated guest and checks video,
keyboard input, and tracing. `WIN98_DISK=/path/to/installed.img PROFILE=win98-01
npm run e2e:win98` runs the Win98 desktop/Notepad workflow. Each automated run
owns its browser/server and uses a fresh output directory.

Run builds, packaging, and guests serially. Use Node with memory64 support
(the retained environment uses Node 26), and an installed Chrome/Playwright
for browser checks. The local automation dependency is separate from source.
Set `DEFUSS_VM_CHROME` to an installed Chrome executable, or use Playwright's
configured browser installation.

The copied local automation installation is available in this workspace;
`npm ci --ignore-scripts` restores its pinned dependencies in a new checkout.

```sh
node --test packaging/bun-app/test.mjs
node packaging/bun-app/test-auto.mjs fresh-auto-label
node packaging/bun-app/test-e2e.mjs fresh-snapshot-label
node tests/bun-smoke.mjs runtime/x86_64 fresh-bun-label
node tests/arm64-linux.mjs runtime/aarch64 fresh-arm-label
```

The Bun smoke uses the unchanged historical benchmark initramfs and validates
all twelve measured results; its timings are correctness-run diagnostics.
The ARM smoke checks real Linux, virtio/NVMe read/write data, and NIC enumeration.
It does not establish external networking or long-run ARM performance.

The completed consolidation passed the clean three-target build, both Bun
workload runs, both ARM64 storage runs, both x86 boot fixtures, and snapshot
checks on retained and rebuilt x86-64 runtimes. The exact checks and report
hashes are in [manifests/validation.json](manifests/validation.json).

For the real/protected-mode x86 boot smoke:

```sh
python3 scripts/sdk.py as --32 tests/x86-boot.S -o artifacts/x86-boot.o
python3 scripts/sdk.py ld -m elf_i386 -Ttext 0x7c00 --oformat binary \
  artifacts/x86-boot.o -o artifacts/x86-boot.bin
node tests/x86-boot.mjs artifacts/build-new/runtime/i386/qemu-system-i386.js fresh-i386-label
```

This smoke validates boot-mode transitions and arithmetic, not a complete
Windows 98 acceptance run. See [CONSOLIDATION.md](docs/CONSOLIDATION.md) for the
actual checks and remaining limits of this import.

## Licensing and development

The inherited QEMU licensing is preserved in [LICENSE](engine/qemu/LICENSE),
[COPYING](engine/qemu/COPYING), [COPYING.LIB](engine/qemu/COPYING.LIB), and source
file headers. Firmware and subprojects retain their separate notices.
The new source tree is intentionally based on QEMU rather than relabeled as
an unrelated implementation.

Read [PLAN.md](PLAN.md) for the next architectural work. Keep the retained
runtimes and evidence immutable, build candidates separately, and distinguish
correctness validation from a new performance confirmation.
