# Passive FIFO held-out capture/restore

Fresh Node full-system correctness runs for the exact passive performance runtime. The unchanged `tests/accelerators/msg2-heldout.mjs` payload supplies192 direct/streamed SHA cases (384 digests), spanning24 lengths,8 deterministic input rounds, offsets and streaming chunk boundaries. Its old filename/prefix is retained as payload identity; reports use `defuss-passive-fifo-heldout-v1`. Historical reports used by the host oracle unit test are explicitly not passive guest evidence.

The new packager requires the successful build report, prepared source overlay manifest and independent post-build `source-recheck.json`. It pins the reviewed performance source fingerprint and the overlay/reviewer identities, checks all seven runtime files, and writes a bound `runtime-provenance.json`. `--workload finite` packages the unchanged7509-byte sustained bundle for the separately frozen finite-horizon timing harness; its manifest matches that harness's packager and includes extra provenance outside the guest payload. All packages and outputs must be fresh.

The runner imports the frozen finite-v1 adapter: one pre-vCPU FIFO choice, diagnostic marker0, no MSG1/MSG2/M3/profile combination,512MiB guest,128MiB TB buffer,flags3/hot1500,12000 cap. On completion off must have locked status6/state0; on must have status7/effective state3/rejections0. This proves eligible policy execution, not that a soft retirement occurred. Separate owning-worker diagnostics establish policy events.

Both modes need a cold capture and read-only restore. Restores require exact capture manifest and report identity, never replace/delete snapshots, and verify snapshot envelope, compressed bytes and raw inner SHA before acceptance. The same source/runtime payload hashes are checked before and after execution. Every completed run is retained. Timings are ineligible for performance inference.

Prospective commands after the actual performance build and post-build review pass:

```sh
node tests/passive-fifo-heldout/package.mjs --workload heldout --base artifacts/m2-heldout-base-01 --runtime artifacts/passive-fifo-performance-build-01/runtime/x86_64 --build-report artifacts/passive-fifo-performance-build-01/build-report.json --source-manifest artifacts/passive-fifo-performance-source-01/source-fifo-overlay.json --source-recheck artifacts/passive-fifo-performance-build-01/source-recheck.json --enabled 0 --output artifacts/passive-fifo-heldout-package-off-01
```

Repeat with`--enabled 1` and a fresh on package. For finite workload packages use`--workload finite --base artifacts/m2-sustained-v2-bundle-01/app.mjs.app`, the same provenance flags, and fresh`artifacts/passive-fifo-package-off-01` /`on-01` outputs.

```sh
python3 -B scripts/with-tmp.py -- node tests/passive-fifo-heldout/run.mjs artifacts/passive-fifo-heldout-package-off-01 artifacts/passive-fifo-heldout-off-capture-01
python3 -B scripts/with-tmp.py -- node tests/passive-fifo-heldout/run.mjs artifacts/passive-fifo-heldout-package-off-01 artifacts/passive-fifo-heldout-off-restore-01 artifacts/passive-fifo-heldout-off-capture-01
```

Repeat serially for on. The operator owns lifecycle serialization. No guest was run as part of source validation. Host tests use project`tmp` and synthetic build records; they do not certify a real build.
