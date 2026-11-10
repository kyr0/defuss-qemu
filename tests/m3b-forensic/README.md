# M3b bounded forensic capture

This is a new host-only diagnostic adapter for the unchanged M3b build01 and
45-gate fixture01. It investigates the retained ON01 gate8 discrepancy; it does
not change the original acceptance oracle, translation admission, generated
code, runtime JavaScript, guest ELF, or initramfs. It is ineligible for timing.

The original ON01 record has 485 fused B attempts where the unchanged oracle
requires 486, together with 65 ordinary B selected entries instead of 64. The
gate8 guest digest and check count agree with its independent oracle. An interrupt-restored
RF variant is a source-supported hypothesis, not a finding established by those
aggregate counts. Ordinary selected entries include attempted entries that may
return at the generic pending-request prologue; they are not retired bodies.

## Exact scope and retained evidence

The command line is the frozen 45-gate command line, including the native safe
profile, `apic.vapic=off`, M3a enabled in both arms, hotness1500, admission flags2,
and the unchanged12000 cap. The only additional QEMU arguments are
`-d exec,in_asm,cpu -dfilter <ranges> -D /guest/m3b-tb.log`. The ranges are all11
actual static ELF program extents `[A,end)`, verified against the retained build
layout. There is no `nochain` flag or address-based eligibility change.

`guest.mjs` installs regular-file VFS write sinks before QEMU opens its files.
The actual retained QEMU `util/log.c` opens the configured log with `fopen` and
flushes on `qemu_log_unlock`; the actual generated FS implementation calls the
node's `stream_ops.write` and advances the file position. The sink copies bytes
and tracks logical file size without calling the original MEMFS write, so the
entire native trace is not retained in guest MEMFS. The host owns the durable
stream. The stream is not read back through the synthetic VFS file.

Limits are explicit failures, never truncation accepted as complete: trace256MiB,
serial4MiB, stderr1MiB, chunk64KiB, unacknowledged bytes2MiB, chunks100000,
progress200 rows/1MiB per row/16MiB total, chunk-index32MiB, and events1MiB.
Serial partial lines are bounded to64KiB. All11 warm-up programs can therefore
be investigated without a whole-guest or kernel trace; exceeding a bound fails
the capture and retains the acknowledged prefix.

Each chunk has a global sequence, per-stream offset, copied bytes, and SHA256.
The host acknowledges it only after its file bytes and index entry are fsynced.
Before native gate validation, the guest is stopped, raw96/128/256-word banks
are copied, and the current byte prefix is drained. The host durably records
that raw observation before invoking the unchanged oracle. A semantic refusal
is returned as structured data: it sends no new guest ACK or `cont`, lets the
browser return its failed report, and drains serial and trace while the browser
is still alive. This avoids the earlier fatal-promise race that lost the serial
log. Page crashes and transport failures still preserve acknowledged prefixes,
but are explicitly partial observations.

The retained files are `native-trace.log`, `serial.log`, `stderr.log`,
`chunks.jsonl`, `progress.jsonl`, `events.jsonl`, `request.json`, the copied SDK
completion evidence, and `report.json`. Final stream hashes must equal the
durable ledger. Every input and served asset is bound to the real frozen
source/build/runtime/image evidence and rechecked after browser closure. Native
graph/object text, effective profile status, stopped state, watch epochs, raw
counter banks, and selected generation are retained separately from log text.

## Interpretation

Trace parsing happens once after the browser has closed. `exec` records are
outer-chain entries, not every internal Wasm or TCI entry. `cpu` records retain
the full printed integer/lazy-flag frame; they do not cover all architectural
state. Stopped-chain messages identify requested-entry exits at their actual
logging site. A log code pointer is a transient TB identity, not a descriptor
generation. Disassembly establishes translated bytes, not execution by itself.
The entire boot trace is retained and hashed, but64-bit parsing starts at the
fixed acknowledged layout gate0 boundary, before the first user-work phase.
That boot prefix is explicitly unclassified; there is no selective skipping
within subsequent user-work windows.

The separate `inspect.mjs` tool rechecks the persisted byte/index/progress
evidence and uses `trace.mjs` only for narrowly supported RF A-to-B or A-to-side
transitions with matching entry registers and flags. Gaps, unsupported code,
incomplete frames, and ambiguous transitions are not counted as certified
execution. Neither these certificates nor a non-recurrence relax the original
45-gate oracle. A clean run is still inconclusive about why ON01 differed;
confirmed evidence must be assessed before proposing any revised partition.

The pinned x86 frontend routes IRET through `EOB_ONLY`; an ordinary RF A disables
`jmp_opt`, clears RF at its `EOB_ONLY` exit, and returns to the outer dispatcher.
For the supported fixture preludes, adjacent CPU records with no stopped-chain
message, the expected prefix effects, all16 integer registers, computed CMP
flags, and full lazy-CC values can therefore establish that A prelude's exit.
They do not establish that the following B body subsequently completed.

## Source status and prospective commands

These14 new files are draft source. They have not been syntax-checked, tested,
frozen, independently accepted, or run as a VM at the time of writing. The
existing57-file implementation freeze and all previous reports remain unchanged.
The host tests include the real retained ON01 failure as a regression: the
original B-attempt assertion must continue to reject it.

Root runs the focused checks in a safe serial interval and retains their logs:

```sh
python3 -B scripts/with-tmp.py -- node --test tests/m3b-forensic/test.mjs tests/m3b-forensic/test-transport.mjs tests/m3b-forensic/test-trace.mjs
python3 -B scripts/with-tmp.py -- node --check tests/m3b-forensic/run.mjs
python3 -B scripts/with-tmp.py -- node --check tests/m3b-forensic/guest.mjs
python3 -B scripts/with-tmp.py -- node --check tests/m3b-forensic/inspect.mjs
python3 -B scripts/with-tmp.py -- python3 -B tests/m3b-forensic/freeze.py \
  --output artifacts/m3b-forensic-source-01 \
  --test-evidence artifacts/m3b-forensic-host-tests-01/tests.log \
  --test-evidence artifacts/m3b-forensic-host-tests-01/syntax.log
```

Only after the actual independent source review passes:

```sh
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
python3 -B scripts/with-tmp.py -- node tests/m3b-forensic/run.mjs \
  --binding artifacts/m3b-diagnostic-binding-01/binding.json \
  --fixture artifacts/m3b-fixture-01 \
  --source-manifest artifacts/m3b-forensic-source-01/manifest.json \
  --source-review artifacts/m3b-forensic-source-review-01/review.json \
  --enabled 1 --timeout 1800000 --output artifacts/m3b-forensic-on-01
```

All scratch must use `scripts/with-tmp.py` and project `tmp`. The guest deadline
is30 minutes; the host watchdog rejects independently of the queued file I/O
after an additional20 seconds. Chrome launch and navigation each have60-second
limits. The controller must also impose an outer owned-process lifetime bound
(recommended35 minutes) and retain any controller abort: blocked host I/O,
browser cleanup, or a blocked JS event loop cannot be bounded by its own timer.
Do not start another guest or build until that owned browser has stopped.

An OFF diagnostic uses identical arguments with `--enabled 0` and a fresh
output directory. It is not a replacement for the retained baseline OFF run.
After the capture process and its browser have closed:

```sh
python3 -B scripts/with-tmp.py -- node tests/m3b-forensic/inspect.mjs \
  --run artifacts/m3b-forensic-on-01 \
  --output artifacts/m3b-forensic-inspection-01
```

Its output is diagnostic evidence, never baseline acceptance.
