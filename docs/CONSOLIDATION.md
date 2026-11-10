# QEMU baseline consolidation

The imported production baseline is the independently confirmed RNDS2 runtime
used in the smolvm comparison. Its source overlay includes the direct PSHUFB
lowering. It does not include the unconfirmed setup/PMAXUB combination or other
experimental candidates.

The original workspace is preserved. All new source, runtime, packaging,
browser support, and guest validation inputs are inside `defuss-vm`. Docker/Lima,
the SDK image/cache, Node, Chrome, and Playwright are host tools, not hidden
source dependencies.

## Selection and provenance

- `engine/qemu` starts from the existing patched `qemu-11.1.3-wasm` tree.
- `tcg/tcg.c` and `tcg/wasm64/tcg-target.c.inc` use the saved production RNDS2
  overlay. Every file has an origin and SHA256 in the import manifest.
- The retained x86-64 and ARM64 JS/WASM artifacts are copied byte-for-byte.
- The ARM64 no-direct-chaining correctness workaround remains in
  `target/arm/cpu.c`; explicit guarded stack sizes remain in the build driver.
- QEMU source/build licenses, third-party notices, relevant prebuilt firmware,
  and prepared internal DTC sources are retained.
- Firmware source projects are not built by this emulator build. Their original
  source trees remain in the parent workspace; the QEMU firmware README and
  submodule metadata retain upstream provenance.

The new driver performs a clean three-target build with no previous objects or
configured build directories mounted. The selected targets share one source
tree; x86-64 also retains the boot modes required by legacy x86 guests.

## Pruning decisions

The import inventory lists excluded files and reasons. The large exclusions are
firmware projects, unsupported guest CPU/machine code, native host TCG backends,
BSD userspace, unrelated Linux ABIs, unrelated TCG tests, and upstream CI tooling.

Shared Kconfig symbols remain even for removed implementations. The first
configure attempt demonstrated that target-level Kconfig files are also required;
those small files were restored and all three device configurations were checked
with `minikconf.py`. The failed attempt is retained under `artifacts/build-01`.
The second configure attempt identified obsolete trace-generation entries for
removed directories; those entries were removed from the root Meson list. Its
log remains under `artifacts/build-02`. The third clean build passed for all
three targets: about 128 seconds configuring and 537 seconds compiling/linking.

Build-metadata changes remove Meson traversal into absent implementation
directories and firmware catalogs. They do not change translated CPU behavior.
Shared headers/device code and general tests are retained until a narrower
dependency analysis establishes that they can be removed without losing the
planned Linux/Windows 98 profiles.

The initial browser support import was the 17-module transitive dependency closure of
the PC runtime, graphics/audio bridges, QMP, and serial support. The Bun launcher
uses a small extracted QMP module so it need not import the whole PC helper.
The extracted QMP class and serial queue behavior are unchanged.

The subsequent [E2E migration](../e2e/README.md) adds the browser pages and
remaining UI/worker dependencies, reusing those original modules unchanged.
Its separate [import manifest](../manifests/e2e-import.json) and
[validation record](../e2e/VALIDATION.md) preserve the initial consolidation
evidence and identify the additional coverage.

## Packaging behavior

The project-local bundler defaults to the retained RNDS2 runtime, Linux amd64,
pinned Bun 1.4.4 distroless, and COM1 snapshots. It accepts an explicit candidate
runtime directory. Image, kernel/initramfs, runtime, and configuration identities
remain part of snapshot compatibility. The default in the old workspace is
unchanged.

The bundling container command is configurable as a JSON argv array. No source
path points back to the old Lima binary or project. The builder mounts only this
project and a staging output directory and uses the same pinned Bun image.

## Validation record

The final machine-readable record is [manifests/validation.json](../manifests/validation.json). It distinguishes
retained artifacts from freshly rebuilt artifacts and records actual outcomes.
Builds, packaging, and guests run serially. These are consolidation correctness
checks, not a new performance campaign.

The intended checks are:

1. Rehash the imported sources, explicit metadata edits, excluded-path inventory,
   retained runtime binaries, and guest inputs.
2. Configure and build x86-64, x86-32, and ARM64 from only this directory.
3. Run the existing five snapshot/serial host tests.
4. Exercise automatic Bun packaging, cold capture, and fresh-process restore,
   checking retained nonce, file, and HTTP state.
5. Execute the unchanged Bun workload with all twelve original expected results.
6. Boot real ARM64 Linux and verify virtio/NVMe contents and NIC enumeration.
7. Boot a real/protected-mode x86 fixture on the i386 target, verifying arithmetic
   and mode transitions.

The actual final status must be read from the validation record, not inferred
from this checklist. A fresh build is not assumed to have the historical
performance result. A protected-mode boot fixture is not a full Windows 98
acceptance test; no new Windows UI performance claim is made.

The completed serial suite under `artifacts/validation/consolidation-03` passed
all twelve stages, including both original Bun runs (24 expected results total),
both ARM64 boots/storage checks, both x86 mode-transition fixtures, automatic
snapshots, and manual Node/browser snapshots. The original and changed apps kept
separate cache identities; Chrome restart retained app state. The i386 result
is now staged under `runtime/i386` with its own recorded provenance.

Earlier validation attempts are retained: the first stopped because QEMU's
Python generators recreated excluded bytecode caches; these were removed and
future builds disable bytecode writes. The second stopped before launching the
x86-64 fixture because a generated report label contained an underscore; the
label construction was corrected. Neither was a guest correctness failure.

An additional explicit-runtime check passed cold capture and fresh-process
restore with the newly rebuilt x86-64 binary, preserving the same nonce, file,
HTTP state, and snapshot file bytes/timestamp. Its record is
`artifacts/validation/consolidation-rebuilt-snapshot-01/report.json`.

Final verification checked all 10,102 imported source files, 69,026 excluded
paths, retained artifact/runtime pins, and the original source inputs without
finding a mismatch. The original tree and runtime defaults remain unchanged.
