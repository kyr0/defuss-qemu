# Default-engine call-boundary probe

Actual Node 26.11.1 / V8 14.6 and Chrome 157 / V8 15.7 runs completed on
2026-11-08 after the SDK builder stopped. These are controlled i32 recurrence
microbenchmarks, not the Bun integer workload or an estimate of VM speedup.

Each variant performs the same checked LCG update through a helper: a
same-instance WASM function, a direct imported WASM function from another
instance, or a JavaScript import. The caller loop stays in WASM. Each variant
receives 32 warmup calls of one million updates, with event-loop opportunities
between warmup rounds. Eight alternating-order measurement blocks then run
five million updates per variant. Source selection supports same-instance
inlining and rejects cross-instance inlining; this probe does not observe the
actual compiled tier or isolate inlining from other calling-convention costs.

| Host | Same instance median | Native cross-instance median | JS import median | Paired native/same ratio | Paired JS/same ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node | 7.179 ms | 9.021 ms | 23.494 ms | 1.306 | 3.363 |
| Chrome | 5.350 ms | 7.950 ms | 59.700 ms | 1.561 | 11.249 |

Medians are across eight within-process blocks; ratios are geometric means
of paired block ratios. These are descriptive samples, not eight independent
browser launches or a claim that one engine is universally faster. The probe
has no memory64 arguments, guest translation, SIMD, Asyncify, or guest kernel.
It establishes a measurable native cross-instance boundary in this small
case, and a materially different JS-import cost. It does not justify counting
ordinary RNDS2 helper calls as JS calls or multiplying these ratios by a VM
helper census to predict a speedup.

All variants matched the independent scalar recurrence oracle for edge/short
counts and every measured result. Binary modules and source hashes are retained.
No custom V8 flags or debugger domain were used. Chrome's owned process
arguments were observed and contain no `--js-flags` override. The Node default
option report is retained separately; it is not a tier trace.

The first attempt completed Node measurements, then Chrome rejected the CDP
`Browser.getBrowserCommandLine` metadata request because its launch lacked
`--enable-automation`. It failed before Chrome measurements. Those Node data
and the failure remain immutable. A new Chrome-only driver records the metadata
limitation and obtains the owned command line using `ps`, without changing
launch flags. It completed successfully; no Node measurements were replaced.
Owned-browser cleanup passed for both attempts.

- [Node data](../../artifacts/engine-cost-01/node.json), [original input identities](../../artifacts/engine-cost-01/inputs.json).
- [Chrome data and actual arguments](../../artifacts/engine-cost-02/chrome.json), [Chrome input identities](../../artifacts/engine-cost-02/inputs.json).
- [Retained first execution](../../artifacts/engine-cost-execution-01/execution.json), [Chrome-only execution](../../artifacts/engine-cost-execution-02/execution.json).
- [Probe implementation](../../experiments/engine-cost/boundaries.mjs), [engine source findings](README.md).
