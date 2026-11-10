# MSG2 exposure in the original Bun workload

This isolated diagnostic harness uses the original M1 bundle and guest ACK
protocol, with production `hotLimit:1500`, `runtimeFlags:3`, one vCPU and 512MiB
guest RAM. Exact bundle and initramfs hashes are pinned in `exposure.mjs`.
The retained M1/M2 timing files are unchanged. Adapter copies and their source
and resulting hashes are recorded in `adapter-provenance.json`.

The runtime must expose the MSG2 diagnostic counter ABI and must not expose the
M1 profiler. Configure it with the existing package tool, using a fresh output
for each mode and the same diagnostic runtime bytes:

```sh
node benchmarks/harness/m2/package.mjs --base artifacts/m1-baseline-01/app.mjs.app \
  --runtime artifacts/m2-msg2-diagnostic-build-new/runtime/x86_64 \
  --enabled 0 --output artifacts/m2-exposure-package-off-new
node benchmarks/harness/m2/package.mjs --base artifacts/m1-baseline-01/app.mjs.app \
  --runtime artifacts/m2-msg2-diagnostic-build-new/runtime/x86_64 \
  --enabled 1 --output artifacts/m2-exposure-package-on-new
node benchmarks/harness/m2-exposure/run.mjs \
  --package artifacts/m2-exposure-package-off-new --output artifacts/m2-exposure-off-new
node benchmarks/harness/m2-exposure/run.mjs \
  --package artifacts/m2-exposure-package-on-new --output artifacts/m2-exposure-on-new
node benchmarks/harness/m2-exposure/analyze.mjs \
  --control artifacts/m2-exposure-off-new/report.json \
  --candidate artifacts/m2-exposure-on-new/report.json --output artifacts/m2-exposure-analysis-new
```

Run these serially, with no compiler or other guest measurement active. The
runner requires fresh capture caches and output directories. It preserves
failures and never overwrites raw results. The outer report protocol is
`defuss-m2-exposure-v1`; existing timing loaders reject it. Every elapsed time
is diagnostic and ineligible for performance decisions.

At each stopped warmup/start/result boundary, read the three cumulative uint64
banks without resetting them. Raw values and deltas are decimal strings,
preserving values above JavaScript's safe integer range. The original-helper
bank includes compiled fallback; total executions are original plus inline,
and interpreted executions are original minus compiled fallback. Decreasing
banks, impossible partitions and mode mismatches fail validation.

Each of the three actual Bun SHA phases must demonstrate compiled inline
execution when enabled, or compiled fallback when disabled. JSON, HTTP and
integer exposure is reported honestly, including zero. Counts include guest
control and stop-delivery tail within each phase; they do not identify every
guest library caller. Initialized and complete cumulative observations retain
boot and between-phase exposure that is outside the measured phase deltas.

The analyzer rechecks package, source, snapshot, map and report identities;
replays the unchanged guest protocol and raw serial records; and recomputes all
counter deltas before producing workload totals. Mode packages must contain
identical diagnostic artifact bytes and independent capture nonces. It emits
no speedup ratios and cannot promote the candidate. Diagnostic instrumentation
can affect admission and scheduling; this establishes execution-path exposure
under the production configuration, not an uninstrumented timing benefit.

```sh
node --test benchmarks/harness/m2-exposure/exposure.test.mjs
```
