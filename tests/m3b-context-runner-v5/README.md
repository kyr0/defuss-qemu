# M3b host accounting v5 over unchanged census ABI2

This new24-file source set contains17 runner files and seven accounting-v3
files. It preserves the native ABI2 runtime, original45-gate guest workload,
complete entry census, RF route certificates,512MiB total trace,64MiB pending
queue,128MiB stopped windows and the reviewed v4 terminal parser.

The v4 ON01 capture failed at gate3 because the old positive-window contract
required global `tciTargetReturns` to stay zero. It retained the correct guest
result, zero census faults,614 fused compiled attempts, zero fused TCI attempts,
63 ordinary-RF TCI attempts and zero fused TCI backedge returns. The global
handoff count increased by one. The reviewed `tcg/wasm64.c` sites increment
that global counter when an ordinary TCI goto targets a fused owner, then
return to the outer guard before admission and fused execution. It is neither
a fused-body TCI entry nor a retired-body count. The capture remains failed;
its independent audit and immutable v4 source chain are mandatory evidence.

Accounting-v3 removes only the incorrect zero condition on this global
handoff counter and reports its monotonic observed delta separately. The
original per-PC selected compiled/TCI, service, backedge, owner, generation,
context and RF/body conservation requirements remain exact. A handoff never
substitutes for required compiled fused exposure. Source-equivalence and
corruption fixtures require unrelated negative checks to remain fatal.
The new host oracle changes only its accounting import paths; no native
instruction, admission, dispatch, chaining, guest or timing behavior changes.

The new terminal parser accepts an empty suffix or only newline-terminated
ASCII `Linking TBs 0x<nonzero uint64 hex> index <0|1> -> 0x<nonzero uint64 hex>`
lines. Partial lines, blank lines, CR, malformed pointers/indices and every
other byte or record type fail. There is no suffix skipping, splitting,
filtering or fallback to the general trace parser. A separate
`terminal-summary.json` retains exact offsets, byte count, SHA256, link count,
zero execution-record count, source site, bound native source identity and
runtime fingerprint. It is fsynced before the complete oracle runs and is
also bound as `report.terminalSummary`; the45 original stopped-window
summaries remain separate and unchanged. Offline replay derives the same
summary from the retained raw bytes.

The complete oracle additionally requires the cumulative watched census
count to equal the preceding final reset. All watch slots are already
disabled then. Neither that equality nor the linking-only log proves absence
of unwatched kernel execution. The claim is only that no Trace, Stopped, CPU,
disassembly or unknown record occurs in this exact terminal suffix.

`windows.mjs` retains source-bound copies of the ABI2 `segment` and
`parseContextTrace` functions with the previously reviewed128MiB guard.
Source-equivalence tests require the full v4 windows/terminal module to remain
byte-identical and the host oracle to change only accounting import paths. Parser boundary,
malformed-record and publication tests are source-only until root executes
and retains them. Current host tests, source freeze/review and real v5 captures
remain pending at authoring; earlier runtime/build validation does not replace them.

Both arms enable the census before the vCPU starts. Every paused gate retains
raw M3a96/M3b128/boundary256/census2400 banks before semantic decoding. The
census watches exact A only, while the existing M3a/M3b watches retain A and B.
Each gate configures exactly four new census epochs. Positive ON watches,
including warmup, require a fused normal owner. OFF and rejection-shape watches
permit ordinary normal owners and preserve the original validator.

For positive ON measured windows, `validateCensusContextWindow` requires the
complete attempted-entry census and the frozen guest CFG. The logical body
partition is fused B attempts + certified ordinary RF A-to-B continuations +
source-known initial direct-B calls. Requested B exits already belong to the
fused-attempt term. Ordinary B selected counts remain attempted entries and
are never presented as retired bodies. Every RF A attempt must have a complete
raw frame classified as a B transition, a terminal side transition or an exact
generic refusal. Unclassified or ambiguous continuations reject acceptance.
The raw normal/RF tuples bind owner generation, code/header, physical pages,
flags/cflags and execution context, including hidden normal entries. The warm
owner must remain stable. Final guest integer, flags and defined legacy FXSAVE
checks and every original digest/check total remain unchanged.

The prior closed forensic-v2 gate3 had486 fused B attempts and64 certified
ordinary RF A-to-B continuations with the expected550-body guest result. That
failed old-runtime capture remains failed. It cannot satisfy the new census
requirement or be retroactively accepted.

Capture and durability bounds are fixed before execution:

- Distinct report/factory argument arrays prevent Emscripten's program-name
  insertion from changing the declared command line.
- All eleven exact ELF extents are logged with `exec,in_asm,cpu`, without
  `nochain`. Total trace is bounded at512MiB, the raw producer queue at64MiB,
  each stopped gate parse window at128MiB, and the complete suffix at64KiB.
  Overflow fails; bytes are never dropped.
- Canonical base64 chunks contain at most64KiB. Data and contiguous hash/index
  metadata are fsynced before host acknowledgement. Gate drains require zero
  pending bytes and produced=queued=acknowledged totals; queue peaks and latency
  fields are retained. No VM yield, forced GC or emulated service turn is added.
- The layout-gate0 boot prefix is retained and hashed, but is not interpreted as
  64-bit user code. Subsequent windows start at the exact prior ACK offset;
  no user bytes are skipped. Each window is parsed while the VM remains paused,
  and its bounded summary is fsynced before the acceptance oracle runs.
- Oracle refusal sends no further ACK/cont. Page errors, deadlines and final
  pause failure retain failure evidence. An external owned-process deadline
  remains required for blocked host I/O or browser teardown.

`inspect.mjs` replays closed captures with the same reviewed oracle. It streams
all indexed chunks and parses one bounded window at a time, verifies the
combined source/runtime/image proof, raw serial sequence, bank epochs and
saved windows and terminal summary, and rehashes all retained inputs. This is same-code replay;
independent capture review remains a separate gate. Recovery, natural
retirement, general DMA correctness and full extended architectural state are
not established by this fixture.

The unchanged combined ABI2 source manifest/review remain authoritative for
the runtime. The separate host-v5 freeze requires that full parent proof,
the frozen v4 host manifest/review and the independent failed-v4 ON capture
review. `identity.mjs` invokes the unchanged v4 verifier and its full earlier
ABI2 chain, then verifies all24 new live/archive files and dependencies.
The native `tcg/wasm64.c` and `tcg/m3b-runtime-head.inc` counter sites are
mandatory dependencies alongside the terminal logging source. The new host source never substitutes a runtime
binding. Future commands require a stopped builder, completed host checks and
independent source review:

```sh
python3 -B scripts/with-tmp.py -- node --test --test-concurrency=1 \
  tests/m3b-context-runner-v5/test.mjs \
  tests/m3b-context-runner-v5/test-transport.mjs \
  tests/m3b-context-runner-v5/test-trace.mjs \
  tests/m3b-context-runner-v5/test-windows.mjs \
  tests/m3b-context-runner-v5/test-oracle.mjs \
  tests/m3b-context-accounting-v3/test-contract.mjs \
  tests/m3b-context-accounting-v3/test-census-reader.mjs \
  tests/m3b-context-accounting-v3/test-integration.mjs

python3 -B scripts/with-tmp.py -- node tests/m3b-context-runner-v5/run.mjs \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --fixture artifacts/m3b-fixture-01 \
  --source-manifest artifacts/m3b-context-v5-source-01/manifest.json \
  --source-review artifacts/m3b-context-v5-source-review-01/review.json \
  --enabled 0 --timeout 1800000 --output artifacts/m3b-context-v5-off-01
# Repeat serially with --enabled 1 and a fresh artifacts/m3b-context-v5-on-01.

python3 -B scripts/with-tmp.py -- node tests/m3b-context-runner-v5/inspect.mjs \
  --run artifacts/m3b-context-v5-on-01 --output artifacts/m3b-context-v5-inspection-on-01
```

`DEFUSS_VM_CHROME` must name the reviewed Chrome binary. The fixed profile
retains512MiB RAM, `apic.vapic=off`, M3a enabled, hot1500/flags2 and cap12000.
All scratch stays under project `tmp`. Prospective artifact names above are
not evidence that a binding, build or real capture already exists.
