# M3b paused cache-recovery companion

This new host adapter reuses the unchanged 45-gate M3b guest ELF/initramfs and
the already designed, stopped-only M3a diagnostic API in the M3b runtime. It
does not change QEMU, generated Wasm, native admission, the guest program, its
work, or any frozen M3b source. It has no timing claim.

Current status: source draft saved; host tests, source freeze, independent
review and actual recovery captures are outstanding. No tests or VM have been
started while the root-owned SDK build is active. The test file is synthetic
host corruption coverage, not engine-validation evidence. Real recovery runs
are scheduled only after the original 45-gate and intermediate-boundary
fixtures have passed for the actual bound runtime.

## Exact bounded cases

The on arm performs two supported actions, with all vCPUs paused and an exact
one-byte A-PC watch enabled. The native API independently requires the single
enabled worker and exactly one valid compiled owner/instance; a refusal is a
failure, not permission to select another object or relax its checks.

* After gate 1 (the add32 warmup), `stale-instance` marks the cached instance's
  generation stale. Gate 2 must observe exactly one cumulative stale-instance
  miss, at least one additional global installation, compiled fused A entry,
  and the same retained owner generation. No new owner emission, clean retry
  or predecode is allowed in that recovery window. The global installation
  delta is retained but is not attributed exclusively to this user function.
* After gate 5 (the add64 warmup), `invalid-descriptor` clears only the valid
  bit. Gate 6 must observe exactly one guarded fused-entry rejection at that
  A PC, invalidation growth, and a strictly newer owner generation executing
  TCI. Gates 6–8 retain that new generation and require cold TCI exposure,
  zero compiled A selection, and exact attempted/completed B/service counts.
  The unchanged work provides 1,228 subsequent A visits in the ordinary
  case, below hotness 1,500. This case proves correct cold fallback and fresh
  translation; it does **not** require or claim new-generation recompilation.

The off arm executes the identical guest work without either mutation. Both
arms use M3a on, M3b profile 1, hotness 1500, admission flags 2 and the existing
12000 charged-instance cap. The exact safe launch arguments are imported from
the frozen fixture, including `-global apic.vapic=off`, `-nodefaults`,
`pc,acpi=off,hpet=off,usb=off`, one CPU/maxcpu, 512 MiB RAM, `-S`, and a
128 MiB TCG buffer. The native profile must independently become eligible.

All 45 original gate oracles, layout/ELF checks, negative predecode/IR cases,
guest integer/flags and defined legacy-FXSAVE checks, full checksums, ordinary
direct-B selection, and the final 943364-check pass record remain required.
No flush or instance retirement may intervene between the first warm gate and
the end of the second recovery case. Other stale misses and M3a-level invalid
redispatches remain errors. The separate boundary selector must remain idle.

The unchanged strict M3b reader rejects every entry rejection. The isolated
recovery decoder first checks the original raw lifetime count and each raw
watch count against an exact allowance: lifetime zero through the mutation,
then one from gate 6 onward; watch slot 0 equals one only at gate 6 and all
other watch windows equal zero. It sends a zero-rejection copy through the
unchanged decoder to retain its other invariants, then restores the original
counts and raw bytes. Extra, premature, later, or differently watched
rejections are rejected. This exception does not affect any frozen reader or
the baseline zero-rejection acceptance gate.

## Evidence and limits

`guest.mjs` copies raw 96-word M3a, 128-word M3b and 256-word boundary banks,
native status, pool accounting and externally confirmed QMP status before
host decoding. Startup waits for `query-cpus-fast`, then captures the bounded
raw graph/object bytes as well. Missing or running status prevents native
reads and produces an explicit failed raw observation. The host appends and
fsyncs each observation before accepting
it or allowing the next watch change, mutation or ACK. It retains both paused
snapshots around each mutation and a durable request before invoking the API.
Its return-code proxy preserves the existing helper's checks and records the
actual native result and invocation count, including rejected calls. Only the designated injection counter and
exact last-action/PC/generation metadata may change. The old owner generation
is retained from its accepted warm gate, separately from the latest watch.

The runner preserves the baseline runtime/build/source/graph binding, actual
guest build/SDK/compiler provenance (including all ten build sources and the
fixed base initramfs), served asset hashes, stopped compiler-VM
checks, original raw serial replay, bounded Chrome lifetime, and final input
rehash. New adapter live/archive bytes and a separate passed source review
must also match. Progress is capped at 160 records, 1 MiB per record and
16 MiB total. It is crash evidence, not resumable acceptance. Outputs are
exclusive and failures remain retained. `derive.py` checks the exact frozen
runner hash plus retained critical host sections; it does not generate code
or claim equivalence of the new recovery oracle.

These explicit paused metadata mutations do not prove natural SMC, FIFO
retirement, interrupt delivery at B, or owning-worker Asyncify behavior under
natural pressure. They do not claim full intermediate architectural/XSTATE
coverage. Those remain separate fixtures. Kernel work can contribute to
global counters; only the exact watch and mutation assertions receive
per-owner attribution.

## Future commands — root-owned safe interval only

No new image or runtime build is needed. First run the focused host checks
and retain their logs under a fresh artifact directory:

```sh
python3 -B scripts/with-tmp.py -- python3 -B tests/m3b-recovery/derive.py
python3 -B scripts/with-tmp.py -- node --test tests/m3b-recovery/test-replay.mjs
python3 -B scripts/with-tmp.py -- node --check tests/m3b-recovery/guest.mjs
python3 -B scripts/with-tmp.py -- node --check tests/m3b-recovery/run.mjs
```

Archive only this new adapter after those real checks. The following log names
are prospective; the tool requires that the supplied files actually exist.
It rechecks the complete frozen baseline closure but never modifies it:

```sh
python3 -B scripts/with-tmp.py -- python3 -B tests/m3b-recovery/freeze.py \
  --output artifacts/m3b-recovery-source-01 \
  --test-evidence artifacts/m3b-recovery-host-tests-01/derive.log \
  --test-evidence artifacts/m3b-recovery-host-tests-01/tests.log
```

An independent reviewer must then publish
`artifacts/m3b-recovery-source-review-01/review.json` with `status: "passed"`,
`sourceBlockers: []`, and the actual source manifest path/SHA. The freezer
does not manufacture that review. The runtime binding remains the original
M3b diagnostic binding. Run the arms serially after baseline acceptance:

```sh
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
python3 -B scripts/with-tmp.py -- node tests/m3b-recovery/run.mjs \
  --binding artifacts/m3b-diagnostic-binding-01/binding.json \
  --fixture artifacts/m3b-fixture-01 \
  --source-manifest artifacts/m3b-recovery-source-01/manifest.json \
  --source-review artifacts/m3b-recovery-source-review-01/review.json \
  --enabled 0 --timeout 1800000 --output artifacts/m3b-recovery-off-01

DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
python3 -B scripts/with-tmp.py -- node tests/m3b-recovery/run.mjs \
  --binding artifacts/m3b-diagnostic-binding-01/binding.json \
  --fixture artifacts/m3b-fixture-01 \
  --source-manifest artifacts/m3b-recovery-source-01/manifest.json \
  --source-review artifacts/m3b-recovery-source-review-01/review.json \
  --enabled 1 --timeout 1800000 --output artifacts/m3b-recovery-on-01
```

Actual artifact paths may be supplied for an independently reviewed later
build. Runtime/source identity validation is still mandatory. Fresh output
names are required after a failure; no failed evidence is overwritten.
