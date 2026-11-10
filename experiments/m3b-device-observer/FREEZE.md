# OFF observer source freeze

The helper is prepared but unexecuted. Keep draft01/draft02 and the five
reviewed observer files unchanged. Wait for root's timing gap, retain the
observer syntax/test output and this helper's tests under a fresh artifacts
directory, then freeze while source authors are quiet:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-device-observer/test-freeze.py
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-device-observer/freeze.py --output artifacts/m3b-device-observer-source-01 --test-evidence artifacts/m3b-device-observer-host-tests-01.log
```

`--test-evidence` may be repeated for 1–16 existing files under `artifacts`.
Use the actual retained paths; the example log is not produced by this helper.
It archives exact evidence and does not interpret a log as a passing test.
No tests, imports of project JavaScript, browser, Lima, build or guest are run.

The helper pins draft02 and the source review, checks all five draft files and
their old archives, and archives local browser/helper imports, the scratch
wrapper, package metadata, pinned runtime/fixture metadata, lifecycle review
records, test evidence and its own three source files. It verifies literal
local module imports against this explicit closure. Built-in Node modules and
Playwright are recorded externally, with the package lock retained. The
variable runtime import is represented by the pinned build metadata; runtime
assets are checked by the actual observer. Unrelated M3b implementation files
listed in the historical source review are not mutable observer dependencies.

Inputs are bounded to 8 MiB each, 32 MiB total and 256 files. Symlinks and input
changes are refused. Each archive is fsynced and rehashed against its live
input before publication. Staging stays under project `tmp`; the final fresh
directory is renamed under `artifacts` and parent directories are synced.
An atomic per-destination lock prevents concurrent helper publication. A
failed stage and lock remain: inspect them and choose a fresh output, or have
root explicitly recover a proven stale lock. The helper never removes stale
locks automatically and never overwrites an existing output.

Root should independently verify the published manifest and every live/archive
hash before the OFF observation. Source-edit quiet is required through that
verification; this is a checked copy, not a transactional filesystem snapshot.
The manifest reports `source-frozen`, never runtime eligibility or timing
acceptance. The actual observation command remains in the unchanged README.
