# RNDS2 CPU diagnosis

VERIFIED: This experiment leaves the frozen timing harness and production
runtime unchanged. Its host driver reuses the MSG1 guest protocol and oracle
with the retained RNDS2 runtime. A separate collector uses Chrome's CPU
profiler on page and worker targets at a requested 2,000 microsecond interval.
It does not enable the Debugger domain or precise coverage.

The calibration runs a checked WebAssembly recurrence in a real page and a
real worker. It requires observed Wasm samples in both targets before a VM
capture is useful. A VM capture partitions initialization, boot, setup,
warmup and the twelve workload batches. The guest is stopped at protocol
boundaries while profiles are persisted. The controller refuses to run while
the unprofiled campaign lock exists.

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/engine-cpu-profile/execute.py calibrate artifacts/engine-cpu-calibration-01 artifacts/engine-cpu-calibration-execution-01
python3 -B scripts/with-tmp.py -- python3 -B experiments/engine-cpu-profile/execute.py capture artifacts/engine-cpu-rnds2-01 artifacts/engine-cpu-rnds2-execution-01
python3 -B experiments/engine-cpu-profile/analyze.py artifacts/engine-cpu-rnds2-01
```

Use a VAE detached job for the VM capture. Each output path must be new.
The controller retains command, exit and cleanup receipts. Failed attempts
are preserved. All scratch directories are below the project's `tmp/`.

VERIFIED: A separate blocking-wait calibration produced 599 Wasm-frame samples
while the worker waited for a 1.5-second timeout. The analyzer reports raw
leaf counts per isolate and phase, with unmapped frames visible. These counts
do not measure exclusive whole-process CPU utilization. Profiler activation
also enables V8 code logging. The analysis makes no speedup or executed-tier
claim.

The [measured opportunity report](../../research/engines/new-opportunities-01.md)
records the source mapping, candidate mechanisms and unresolved attribution.
The current VAE gate runs `check-evidence.mjs` to rehash the bound inputs
without launching another benchmark.
