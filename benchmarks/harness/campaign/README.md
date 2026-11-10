# Resumable M1 campaigns

This runner executes the existing M1 CLI serially and retains a durable record
before starting each child. A computer crash cannot make it overwrite an old
run directory. It is orchestration, not a new benchmark protocol or performance
confirmation. Keep builds and other VM runners stopped while using it.

The [example plan](example.json) declares retained baseline, diagnostics off/on,
and a fresh-browser restore using sampling period 263. Review/copy it to a new
plan for a new campaign; every step explicitly records its package, mode,
snapshot mode, sampling period and deadline. Restore steps reference an earlier
successful capture. Paths resolve relative to `defuss-vm`, regardless of the
calling directory.
Optional `captureCode: true` passes the M1 runner's `--capture-code` switch;
omission means false. This requires `profile-on`. The option is frozen and
checked against the host and browser reports. Captured byte/segment hashes are
verified; partial or unresolved code capture remains valid diagnostic evidence
and is not upgraded to successful code identification.

```sh
node benchmarks/harness/campaign/run.mjs \
  --plan benchmarks/harness/campaign/example.json \
  --output artifacts/m1-campaign-new
```

Repeat the exact command to resume. A successful step is revalidated, including
the full existing analyzer's protocol/answer/map/profile checks, package/input
identities and snapshot bytes. A valid report written just before the crash can
be adopted. Missing, partial, failed and invalid unaccepted reports are retained;
the next invocation creates a fresh UUID attempt. A nonzero child exit stops
the campaign even if a passed report was written. Changed previously accepted
evidence stops the campaign instead of silently treating it as a new run.

Each attempt contains `request.json` before launch, `spawned.json` when the PID
is available, `child.log`, the child-owned `run/` directory, `exit.json` after
the process and its standard I/O close, and `accepted.json` only after checks
pass. Metadata files use exclusive creation and file/directory fsync. Existing
files are never overwritten. Failed initialization is retained and requires a
fresh campaign output path. The campaign prints accepted report paths for use
with `benchmarks/harness/analysis/analyze.mjs`; it does not combine nested
restores with independent captures or claim statistical confidence.

`frozen.json` records exact plan bytes, the complete packaged inputs, the local
M1/analyzer/orchestrator/code-capture and host/packaging/profile source closure, workload and
baseline pins, package lock, extra plan `inputs`, Node executable/version and
selected Chrome executable identity. `NODE_OPTIONS` is recorded. These hashes
are checked before each step and after each child. Source, plan, package,
browser or Node changes require a fresh campaign. Generated snapshots and raw
reports are output evidence, not part of the source fingerprint.
Generated `packaging/bun-app/validation/` and
`experiments/m1-profile/native-validation.json` are explicitly excluded from the
automatic source closure; an explicit plan `inputs` entry can still pin either.
Python `__pycache__` and Finder `.DS_Store` files are excluded throughout.
Do not place the campaign output inside an input directory. Filesystem symlinks in inputs
and output ancestry are rejected. This is a local-filesystem workflow, not a
network filesystem locking or adversarial concurrent-edit guarantee.

## Locks and crash recovery

An exclusive project-wide `artifacts/.m1-campaign.lock` prevents overlapping
campaign-runner invocations, including ones targeting different output paths.
It cannot detect an independently invoked `m1/run.mjs`, a build, or unrelated
VM software. The runner does not stop unrelated processes. Ordinary completion
and validated child failures release its lock. An interrupted parent or a lost
child handle leaves the lock in place.

Inspect the lock's owner PID/hostname/token, the attempt's recorded command and
child PID, and any owned browser descendants. Only after those processes have
stopped, explicitly archive a stale lock:

```sh
node benchmarks/harness/campaign/run.mjs --recover-lock TOKEN_FROM_LOCK \
  --confirm-owned-processes-stopped
```

Recovery refuses a live owner or an unclosed child PID, including a reused PID;
it does not infer process identity from a PID or kill it. The acknowledgement
covers descendants and the narrow crash window between spawning a child and
persisting its PID. Foreign-host, malformed or partially written locks require
manual inspection; preserve their bytes before moving them aside. A crash during
recovery can also leave `.m1-campaign.lock.recovery`, which must be inspected
before another recovery. Recovery
archives the lock under a fresh name and starts no work. Reinvoke the original
campaign command afterward. No lock is automatically removed based on age.

## Tests

```sh
node --test benchmarks/harness/campaign/run.test.mjs
```

Fixtures test serial operation, duplicate locking, failed/missing/partial report
retries, crash adoption, restored capture identity, source/environment drift,
evidence tampering, stale-lock safeguards, and real child close/error behavior.
They do not launch QEMU or Chrome. Production report validation reuses the
existing analyzer rather than accepting a `status: passed` field alone.

Node 26 process and filesystem semantics were checked against the official
[child-process documentation](https://github.com/nodejs/node/blob/v26.0.0/doc/api/child_process.md)
and [filesystem documentation](https://github.com/nodejs/node/blob/v26.0.0/doc/api/fs.md).
