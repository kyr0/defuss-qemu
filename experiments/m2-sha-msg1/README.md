# Selectable exact SHA256MSG1 source candidate

The isolated overlay and fixtures are implemented in source. Compilation,
fixture execution, full-system integration, diagnostic exposure and performance
validation are pending. No result from MSG2 transfers to this candidate. The
reference engine, official Bun binary and frozen MSG2 sources remain unchanged.

`CONTRACT.md` describes the source-backed arithmetic, alias, allocator, flags and
fault requirements. The original contract-only snapshot is retained under
`artifacts/m2-msg1-contract-01`.

## Implementation

- `lowering.c.inc` saves original `b[0]` before any destination write, emits
  four sequential u32 assignments with sigma0 `rotr7 ^ rotr18 ^ shr3`, and
  preserves R1–R14 and the R15 helper call stack. Only R0 and emitter scratch
  locals are clobbered. The original three-pointer helper ABI is retained.
- `config.c.inc` exposes independent MSG1 ABI1 configuration/status functions.
  One atomic pre-translation choice locks off/on; invalid, duplicate and late
  choices are rejected. Both uninstrumented choices use one runtime binary.
  No mode branch or execution counter is emitted in performance modules.
- `prepare.py` requires the retained RNDS2/PSHUFB baseline without either MSG1
  or MSG2 already overlaid. It preserves the baseline reference helper. Exact
  anchors insert the matcher/emitter after deferred emission and preserve
  normal helper fallback. It creates a fresh copied source and manifest.
- The optional diagnostic overlay adds three MSG1-specific u64 banks: original
  helper entries, compiled inline and compiled fallback. Fallback is a subset
  of original; total is original+inline. Only stopped single-vCPU reads/resets
  are supported. Diagnostic builds are ineligible for performance decisions.

No combined MSG1/MSG2 build is prepared. A later combination needs independent
selectors, four-choice identities, its own correctness checks and fresh
combined-runtime measurement.

## Prepared host validation

`test.py` extracts the original helper body/sigma macro and retained backend
opcode/pointer helpers. It compiles the actual C emitter with ASan/UBSan, then
`test-emitted.mjs` instantiates those emitted bytes in real shared memory32/64
WASM modules. Planned coverage is 20,480 original-helper cases per width, all
five pointer-equality partitions plus partial overlaps, unsigned boundary words,
sentinel bytes and live-local preservation. Sixty additional unaligned cases
per width use a separate byte-based BigInt oracle. Explicit alias probes must
distinguish missing `b[0]` capture and incorrectly preloaded/parallel stores.
The C fixture also exercises signature/function/name/noreturn rejection and
one-time selector races. These fixtures are prepared, not yet run.

All fixture scratch, native binaries and full case data stay in retained
`defuss-vm/tmp/msg1-host-*`. Command/stdout/stderr records and emitted bodies/WASM
stay in a fresh artifact directory. The original helper is never invoked with
unaligned C struct pointers. Host fixture success will not establish frontend,
allocator, faults, asynchronous recovery or real Bun execution.

## Commands for the serialized validation window

Anchor checks read sources only and do not copy a QEMU tree:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m2-sha-msg1/prepare.py --mode switch --check --output artifacts/m2-msg1-source-new/source
python3 -B scripts/with-tmp.py -- python3 -B experiments/m2-sha-msg1/prepare.py --mode diagnostic --check --output artifacts/m2-msg1-diagnostic-source-new/source
```

Run native/emitted-WASM validation only after the timing campaign has finished:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m2-sha-msg1/test.py --output artifacts/m2-msg1-host-new
```

Following review and passing host fixtures, prepare/build in a new serialized
attempt; never overwrite a source, runtime or failed validation directory:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m2-sha-msg1/prepare.py --mode switch --output artifacts/m2-msg1-source-new/source
python3 -B scripts/with-tmp.py -- python3 -B scripts/sdk.py python3 scripts/build.py --source artifacts/m2-msg1-source-new/source --output artifacts/m2-msg1-build-new --targets x86_64-softmmu --jobs 8
```

Use the factory preRun hook before vCPU execution:

```js
if (mod._defuss_m2_msg1_status() !== 0x10000) throw Error('Unexpected MSG1 ABI/state');
if (mod._defuss_m2_msg1_config(enabled ? 1 : 0) !== 0) throw Error('MSG1 selection rejected');
// Before translation: 0x10001 off / 0x10002 on.
// After translation:  0x10003 off / 0x10004 on.
```

The separate MSG1 guest fixture/runner and Bun package identity have not yet
been implemented. Do not invoke the frozen MSG2 harness with this runtime:
its selector and report identities intentionally require MSG2. Full hot/cold
off/on register/memory/fault fixtures, exact counters, unchanged Bun exposure,
held-out inputs, and independent uninstrumented selection/confirmation remain
required before any integrated benefit is claimed.
