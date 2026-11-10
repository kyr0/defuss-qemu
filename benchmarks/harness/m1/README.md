# M1 phase diagnostic harness

This runs the original `benchmarks/workload/operations.ts` unchanged in pinned
Linux amd64 Bun 1.4.4 distroless. It separates integer, JSON, SHA256 and guest
loopback HTTP into 100-call batches, with 10 fixed warmup cycles and three
predeclared orders. All answers are checked on every call. The original source,
canonical answers, bundle, runtime and served browser modules have SHA256
provenance in each report.

From `defuss-vm`, package once per runtime, using a fresh output directory:

```sh
python3 packaging/bundle-bun.py benchmarks/harness/m1/driver.ts --project-root . --outfile artifacts/m1-baseline-01/app.mjs --snapshot-ready manual
python3 packaging/bundle-bun.py benchmarks/harness/m1/driver.ts --project-root . --outfile artifacts/m1-profile-01/app.mjs --snapshot-ready manual --runtime-dir artifacts/m1-build/runtime/x86_64
node --test benchmarks/harness/m1/protocol.test.mjs
```

Set `DEFUSS_VM_CHROME` to a Chrome executable when the installed Playwright
browser is unavailable. Run each command serially. Every report path must be
fresh. The baseline mode verifies the retained RNDS2 JS/WASM identities; the
other modes require the separate M1 diagnostic runtime ABI.
The launcher enforces the fixed 512 MiB/single-vCPU standard Bun configuration
and passes no AOT or translation plan; those paths are unsupported by this
diagnostic campaign and explicitly recorded as disabled.

```sh
node benchmarks/harness/m1/run.mjs --package artifacts/m1-baseline-01/app.mjs.app --output artifacts/m1-runs/baseline-01 --mode baseline
node benchmarks/harness/m1/run.mjs --package artifacts/m1-profile-01/app.mjs.app --output artifacts/m1-runs/off-01 --mode profile-off
node benchmarks/harness/m1/run.mjs --package artifacts/m1-profile-01/app.mjs.app --output artifacts/m1-runs/on-01 --mode profile-on
```

An optional fresh-browser restore uses the same package, an explicit existing
cache and its successful capture report. Snapshot bytes, file identity and
heap/file/nonce continuation are checked; corrupt snapshots are retained and
fail the run, rather than silently replacing the evidence.

```sh
node benchmarks/harness/m1/run.mjs --package artifacts/m1-profile-01/app.mjs.app --output artifacts/m1-runs/on-restore-01 --mode profile-on --snapshot restore --cache artifacts/m1-runs/on-01/snapshots --capture-report artifacts/m1-runs/on-01/report.json
```

`report.json` contains lifecycle timing, every marker/COM1 pairing/ACK, 20 empty
gate calibrations, warmup and all 12 batch results. Each timed interval starts
immediately before the start ACK and QMP continuation, and ends immediately
after the result JSON is parsed. It includes delivery, wakeup, work and result
framing. It excludes stopped counter reads/reset. Calibration is reported as
raw evidence and is not subtracted from phase timings.

All modes stop the VM and confirm stopped status at every gate. `profile-off`
keeps the new ABI disabled and does not create a helper profiling bus.
`profile-on` additionally enables the existing TCG/helper/MMU diagnostics and
the bounded M1 PC/edge profiler during warmup and each batch. The default M1
sampling period is 257, selectable with `--sample-period`. This is a
deterministic sampler, not random sampling or an unbiased population estimate.
PC table replacement error bounds do not describe sampling uncertainty.

Counter collection ends only once the VM has stopped after receiving the
result. `resultToStopMs` records that exposure tail. Guest UART/control code can
therefore appear in profiles. Existing timers have nested scopes; they must
not be added to make an exclusive CPU/wait breakdown. Counts establish
exposure, not elapsed-time fractions. MMU diagnostics exclude inline TLB hits
and separate atomic/probe helpers, so a clean-inline-hit percentage cannot be
computed. Helper lists truncate to 40 entries; RNDS2 inline/helper counters
augment them but do not form a complete SSE/AVX census.

The report stores exact `initialized.maps` and `post-warmup.maps` with their
guest SHA256 and host digest. They identify mappings at those gates only;
later JIT mappings, modified code bytes and code generations are not captured.
Anonymous executable mappings remain anonymous/JIT-unknown. No source-level
JSC tier or function name is inferred from an address alone. PC privilege
comes from the profiler's architectural flags, not address sign.

`vm-adapter.mjs` is a harness-only copy of the validated packaging launcher,
with its original SHA256 recorded in `adapter-provenance.json`. It adds module,
pause/resume and optional helper-bus access. Production packaging is unchanged.
`snapshot-upload.mjs` preserves the existing bounded ordered upload protocol
from the parent benchmark; it has no runtime dependency outside `defuss-vm`.

One baseline/off/on triplet is an exploratory perturbation screen. Batches
inside one VM share state and do not constitute independent repetitions.
These measurements do not establish a performance promotion, clean boot cost
decomposition, exclusive helper fractions or full instruction coverage.

## Resumption and stopped code inspection

Use the [serial campaign runner](../campaign/README.md) for durable checkpoints,
fresh attempt directories and verified resumption after an interruption. The
corrected profiling campaign and its independent review are retained in
[pilot 02](../../../docs/decisions/m1-pilot-02.md). Its original harness sources
were archived under `artifacts/m1-harness-source-v2/` before the following
optional inspection extension.

`--capture-code` is available only with `--mode profile-on`. After each phase's
result, VM stop and counter read, it records up to eight compiled-user PC/raw-CR3
windows with page-table traces and SHA256 hashes. It reads only bounded ordinary
RAM in the fixed 512 MiB PC configuration and rejects unsupported paging modes,
supervisor/NX/nonpresent mappings and unsafe physical addresses. This adds
stopped time and may change later phases; these runs are excluded from the
matched timing and sampling-sensitivity analyzers.

The bytes describe the stopped phase end, not a code generation at each earlier
sample. CR3 remains a context hint rather than a proven process identity. See
the [code-reader contract](../code/README.md). The real inspection campaign uses
[`m1-code-inspection-v1.json`](../../plans/m1-code-inspection-v1.json).

```sh
node benchmarks/harness/campaign/run.mjs \
  --plan benchmarks/plans/m1-code-inspection-v1.json \
  --output artifacts/m1-code-campaign-new
python3 benchmarks/harness/code/inspect.py \
  --report artifacts/m1-code-campaign-new/attempts/ATTEMPT/run/report.json \
  --output artifacts/m1-code-disassembly-new
```

The inspector verifies each complete byte window before wrapping it in a small
synthetic ELF for local objdump. The synthetic ELF is a decoding container with
the original virtual address, not a guest binary or an executable deliverable.
