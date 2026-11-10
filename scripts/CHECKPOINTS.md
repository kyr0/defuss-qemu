# Durable project checkpoints

Coordinate a brief source-edit quiet interval, update `AGENT_HANDOFF.md`, then:

```sh
python3 scripts/checkpoint.py --label resumed-work
python3 scripts/checkpoint.py --verify checkpoints/<printed-directory-name>
python3 scripts/checkpoint_test.py
```

The tool creates a new timestamp/UUID directory under `checkpoints/` with
`source.zip`, `evidence.zip`, current `AGENT_HANDOFF.md`, `manifest.json`, and a
manifest checksum. Originals remain in place. It never overwrites an existing
checkpoint. Staging and retained failed attempts use only `defuss-vm/tmp/`.

The source archive includes authored files and retained runtime files. It
excludes root artifacts/assets/node_modules/.git/tmp/checkpoints/build outputs,
known cache directories, Python bytecode, `packaging/bun-app/validation`,
`experiments/m1-profile/native-validation.json`, and `engine/qemu/build`.
Authored QEMU `target/` and subproject `build/` recipes are preserved. Source
symlinks are stored as link bytes without following their targets.

Evidence selection includes small JSON/JSONL/NDJSON, Markdown, text, maps, logs,
archived Python/JavaScript/TypeScript/C/header/include/assembly/shell sources,
and tiny WASM fixtures under `artifacts/`. Historical source archives such as
`m1-harness-source-v2` retain their actual old code bytes as well as manifests.
WASM evidence has an additional 256KiB cap. It prunes SDK build trees, full source overlays,
runtime/package directories and snapshots. Immutable files over the default
8MiB limit are listed as skipped. Logs capture at most the initial length or
the limit, whichever is smaller, and are always marked partial. A live log may
continue growing; its archived bytes and hash remain exact. Use
`--evidence-limit-mib N` to change the explicit per-file limit.

Every archived member has its original project-relative path, SHA-256, byte
count, object type, permissions and observed filesystem identity in the
manifest. Both complete archives and the separate handoff copy have hashes.
The manifest also retains planned source/evidence file counts and byte totals,
partial-log count and skipped-evidence count from the initial selection.
Verification streams every ZIP member and checks inventories, hashes, sizes,
permissions and CRCs without extracting files. The source inventory and all
selected immutable inputs are rehashed before publication. A changed source,
handoff or immutable report fails the checkpoint. Optional `--retries 1` retries
only detected input changes, in a fresh stage; failed stages remain intact.

Archives, handoff, manifest and checksum are flushed with `fsync`. A short
advisory publication lock protects the destination check and atomic rename;
the lock releases automatically on process exit. Staging and destination must
share a filesystem. The publication parent and staging parent are synced after
rename. On verification failure, `failure.json` and the incomplete stage remain
for inspection. A rare post-rename synchronization failure is reported as such
with the retained published path; the tool does not claim durable success.

This is a verified stable selected-file capture, not a filesystem transaction
or a complete machine backup. Source-edit coordination closes the gap that
ordinary file-by-file copying cannot make atomic. Evidence files first created
after selection are outside that checkpoint. Assets, VM snapshots and omitted
large artifacts remain in their original locations and need separate storage
if a complete machine recovery image is desired.

Small tests exercise archive contents, exclusions, authored build recipes,
symlinks, exact handoff preservation, changed/added sources, changed immutable
reports, live logs, tampering, atomic publication, occupied destinations and
publication contention. Their synthetic fixtures stay under project `tmp/`.
Directory names alone do not exclude small historical `source-*`/`overlay-*`
archives; complete QEMU trees are detected by `meson.build`/`tcg`/`target` and
SDK build trees by `build.ninja`/`meson-private`, in addition to explicit excluded
directory names such as `source`, `build`, `runtime` and `snapshots`.

Implementation follows Python's documented [ZIP streaming/verification](https://docs.python.org/3/library/zipfile.html),
[fsync and atomic rename](https://docs.python.org/3/library/os.html), and
[advisory flock](https://docs.python.org/3/library/fcntl.html) semantics.
