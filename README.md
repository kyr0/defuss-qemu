# defuss-qemu

VERIFIED: QEMU compiled to WebAssembly for x86-64, i386 and ARM64. The selected
release source includes the MSG1 candidate requested by the user;
[its manifest](manifests/consolidation-candidate.json) records the exact source.
The npm loader and browser host enable MSG1 before guest translation. Historical
RNDS2 binaries remain preserved separately. The package name is `defuss-qemu`;
the checkout directory remains `defuss-vm`.

VERIFIED: The [npm packaging guide](packaging/npm/README.md) describes the local
tarball, browser loading and binary sizes. The package has not been published by
this consolidation. Performance parity with RNDS2 is unproven; selecting MSG1
does not turn the retained timing study into a speedup claim.

The retained M0 validation and later optimization experiments have separate
[implementation records](docs/IMPLEMENTATION.md). MSG2, FIFO policy and M3b
remain isolated experiments. Their correctness checks and timing results do
not establish performance for the selected MSG1 build.

The [engine investigation](research/engines/README.md) traces the guest Bun and
JavaScriptCore path through QEMU to the host V8 runtime. Its
[measured priorities](research/engines/new-opportunities-01.md) guide further
optimization; the original plan remains historical context.

Keep task scratch under `defuss-vm/tmp` using
`python3 -B scripts/with-tmp.py -- COMMAND ARGS`. Source, reports and build
outputs stay outside scratch. [Verified local checkpoints](scripts/CHECKPOINTS.md)
retain source/runtime archives, selected evidence and the historical
[resume handoff](AGENT_HANDOFF.md), with hashes and durable publication.

## What is consolidated

- `engine/qemu/`: QEMU 11.1.3 with the existing WASM/Windows 98/Linux changes
  and the PSHUFB, SHA256RNDS2 and selected SHA256MSG1 source changes.
- `runtime/current/`: selected three-target build; the browser harness and Bun
  packaging use its x86-64 runtime by default. These generated files are ignored
  by Git and pinned in `manifests/runtime-selected.json`.
- `runtime/x86_64/`: byte-identical retained RNDS2 runtime for historical replay.
- `runtime/aarch64/`: byte-identical retained ARM64 runtime with guarded 1 MiB
  worker stacks and its required direct-chaining workaround.
- `runtime/i386/`: retained M0 build checked with
  a real/protected-mode boot fixture; this does not add an i386 Bun image.
- `packaging/`: reusable pinned TypeScript/Bun bundler and the COM1 snapshot
  launcher, using only files inside this project.
- `host/browser/`: the dependency closure for QMP, serial, PC storage/display,
  graphics, audio, and profiling; unrelated demo modules are excluded.
- `tests/`, `benchmarks/`: snapshot checks, real guest smoke runners, the
  original Bun operation sources and expected results.
- `manifests/`: per-file provenance, pruning inventory, original build records,
  and immutable runtime/asset identities.

RNDS2 has independently confirmed Bun SHA gains in the retained work.
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

VERIFIED: Bundling defaults to `runtime/current/x86_64` with MSG1 enabled. The
selector is part of the snapshot compatibility identity. Use `--runtime-dir`
to choose another runtime explicitly; incompatible snapshots remain separate.

## Validation

The migrated browser pages and root Win98 automation are in
[e2e/](e2e/README.md). `make start` serves the local test page;
`PROFILE=smoke-01 npm run e2e:smoke` boots a generated guest and checks video,
keyboard input, and tracing. `WIN98_DISK=/path/to/installed.img PROFILE=win98-01
npm run e2e:win98` runs the Win98 desktop/Notepad workflow. Each automated run
owns its browser/server and uses a fresh output directory.

VERIFIED: `e2e/acceptance.py` runs the release checks serially against an
installed npm package. It requires a built Bun bundle, locally supplied guest
media and an installed Windows 98 disk. `e2e/prepare-guests.py` derives the
FreeDOS and BusyBox fixtures from the local FreeDOS floppy and Alpine initramfs;
the supplied `assets/slitaz/slitaz-core-x86_64-cooking.iso` stays unchanged.

| Workload | Acceptance contract |
| --- | --- |
| MSG1 instructions | Seven modes, cold/hot and off/on, exact results and protected-page fault |
| Bun in Node and Chrome | Cold initialization, file/HTTP operations, same-state snapshot restore in another process |
| Windows 98 | Desktop and three untraced plus three traced Notepad cycles |
| FreeDOS | FreeCOM keyboard commands and a FAT file write/read |
| BusyBox | Linux shell, file write/read and interactive serial command |
| SliTaz x86-64 | Graphical desktop, terminal, guest FAT write/read and host readback of a unique marker |

```sh
WIN98_DISK=/path/to/installed.img python3 -B scripts/with-tmp.py -- \
  python3 -B e2e/acceptance.py --package /path/to/node_modules/defuss-qemu \
  --bundle artifacts/automatic.mjs.app --label acceptance-01
```

VERIFIED: `make verify` checks retained release reports and current input hashes
through `.vae/checks/release.py`. Missing or changed inputs fail the check;
`manifests/release-acceptance.json` records the selected reports. These functional
checks establish no timing comparison with RNDS2. Windows 98's untraced cycles
use the same MSG1 candidate as its traced cycles.

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

The historical M0 consolidation passed the clean three-target build, both Bun
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
The package retains the QEMU attribution and includes corresponding source.

Use the [measured priorities](research/engines/new-opportunities-01.md) for the
next investigation; [PLAN.md](PLAN.md) is historical context. Keep the retained
runtimes and evidence immutable, build candidates separately, and distinguish
correctness validation from a new performance confirmation.
