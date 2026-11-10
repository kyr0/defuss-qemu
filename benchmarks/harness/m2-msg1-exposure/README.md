# MSG1 exposure in the unchanged Bun workload

This is a new, isolated diagnostic adapter. No MSG1 Bun exposure run has been
performed by these source checks. It uses the frozen MSG1 diagnostic runtime,
the exact original M1 bundle/guest image and operations, and real Chrome with
production hotLimit1500/runtimeFlags3. Existing MSG1, MSG2, timing and policy
sources and reports are unchanged. This is a separate candidate, not a combined
optimization or a timing experiment.

`identity.mjs` binds the MSG1 source/build fingerprint
`2b7a8b44cff517fd8a02c30151a47bbc6b1776a4f617ef5d1db952c2a218efa3`,
its completed source recheck, frozen implementation/source review and the
independent full arbitrary-input ISA review. That prior matrix is a prerequisite
with a different execution context; its counts do not establish Bun exposure.
All seven runtime artifacts and95 existing evidence identities are rechecked.
The actual runtime hashes are:

- JS `632df56970e2cd5969e54b661dcd251ab1fe4e645fbdb40ca6c6af323fc672cf`
- WASM `9246a4e3b659d7ca77260e8d293ec0a968cecff89255ec1e87ba65ecc3a1cd42`

Packaging substitutes only those JS/WASM bytes into the exact original M1
package and binds the single MSG1 mode into snapshot compatibility. Original
app, initramfs, kernel/ROM, VM settings, operation source and oracle are pinned.
Off/on packages must otherwise match completely. Every run owns a fresh cache,
nonce, browser and output directory. The builder must be Stopped before and
after; the operator must serialize other owned heavy work throughout.

The selector must begin at unchosen ABI1 state0, accept exactly one pre-vCPU
choice, and end translation-locked in the selected mode. MSG2, FIFO, M3 and M1
profiler ABIs are rejected. There is no code capture or generic helper profiler.
`baseline` is the retained M1 wrapper mode name; this artifact remains diagnostic.

Each gate requires both `running:false` and `status:paused`. The diagnostic
bank is read atomically without reset, preserving unsigned64-bit counts as
strings. Original helper entries include the compiled fallback subset:

```
interpreted = original - compiledFallback
all executions = original + compiledInline
```

Every SHA phase must expose the selected compiled path: fallback while off,
inline while on. Off rejects inline execution; on rejects compiled fallback.
Warmup, integer, JSON and HTTP counts are recorded exactly, whether zero or
positive. No MSG2 execution count is an expected MSG1 result.

Analysis retains raw counts at every gate and independently matches phase
begin/end banks to those raw boundaries. Boot, each interphase gap, all13
phases and the tail sum exactly to the complete bank. These inclusive stopped
intervals include guest framing/control and stop-delivery work; they do not
identify every instruction with a Bun library or imply a time fraction.
There is no speedup calculation or promotion decision. The outer protocol is
`defuss-m2-msg1-exposure-v1`, which the original timing loader rejects.

The unchanged M1 protocol checks the runtime identity, parameters, complete
69-gate order,12 measured results and exact integer/JSON/SHA/HTTP oracles.
Raw serial records must exactly equal their reported guest fields after only
the known host annotations are removed; omitted fields and extra records fail.
Kernel panic and `BUN_APP_FAILURE` markers reject the entire raw serial stream,
including unprefixed lines.
Retained maps are replayed independently. The complete progress header binds
schema, package, selected mode, runtime proof and the full input digest map;
each row's schema, kind and pre-ACK event are compared exactly. Browser,
adapter, exposure/protocol modules, shared QMP/machine and serial/snapshot modules,
and every package payload require matching preflight and served-file identities.
Each pre-ACK stopped
event is fsynced into a bounded69-row JSONL file; partial evidence is neither
resumable nor acceptance. Guest console, lifecycle and signal arrays are
bounded, page errors/crashes fail promptly, and output files are exclusive and
fsynced. Reports recheck all inputs, snapshot bytes and served files.

## Prospective commands for the serialized execution owner

Host tests only (no Chrome or guest):

```sh
python3 -B scripts/with-tmp.py -- node --test benchmarks/harness/m2-msg1-exposure/exposure.test.mjs benchmarks/harness/m2-msg1-exposure/identity.test.mjs benchmarks/harness/m2-msg1-exposure/replay.test.mjs
```

After source freeze/review, create both fresh diagnostic packages. These
commands copy retained artifacts; they do not compile or change the guest:

```sh
python3 -B scripts/with-tmp.py -- node benchmarks/harness/m2-msg1-exposure/package.mjs --base artifacts/m1-baseline-01/app.mjs.app --runtime artifacts/m2-msg1-diagnostic-build-01/runtime/x86_64 --enabled 0 --output artifacts/m2-msg1-exposure-off-package-01
python3 -B scripts/with-tmp.py -- node benchmarks/harness/m2-msg1-exposure/package.mjs --base artifacts/m1-baseline-01/app.mjs.app --runtime artifacts/m2-msg1-diagnostic-build-01/runtime/x86_64 --enabled 1 --output artifacts/m2-msg1-exposure-on-package-01
```

Run the two arms serially after other owned VM/build work stops:

```sh
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node benchmarks/harness/m2-msg1-exposure/run.mjs --package artifacts/m2-msg1-exposure-off-package-01 --output artifacts/m2-msg1-exposure-off-01
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node benchmarks/harness/m2-msg1-exposure/run.mjs --package artifacts/m2-msg1-exposure-on-package-01 --output artifacts/m2-msg1-exposure-on-01
```

Only complete passing runs can enter the diagnostic comparison:

```sh
python3 -B scripts/with-tmp.py -- node benchmarks/harness/m2-msg1-exposure/analyze.mjs --control artifacts/m2-msg1-exposure-off-01/report.json --candidate artifacts/m2-msg1-exposure-on-01/report.json --output artifacts/m2-msg1-exposure-analysis-01
```
