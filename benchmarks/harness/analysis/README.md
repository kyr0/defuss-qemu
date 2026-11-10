# M1 report analysis

Run after one successful, serialized launch in each matching mode:

```sh
node benchmarks/harness/analysis/analyze.mjs \
  --baseline artifacts/m1-runs/baseline-01/report.json \
  --off artifacts/m1-runs/off-01/report.json \
  --on artifacts/m1-runs/on-01/report.json \
  --reference artifacts/wasm-reference/chrome-reference-01/report.json \
  --output artifacts/m1-analysis-01
```

Paths resolve against the calling working directory. `--reference` is optional;
it accepts the browser or Node standalone reference report and preserves its
engine identity. The output directory must be fresh. A failed validation stops
before output is created; raw evidence is never edited.

`analysis.json` records hashes for every raw report, process-map file, retained
syscall-name table, baseline pin and analyzer implementation. It verifies the
guest protocol, heap/file continuation identity, every workload result and
phase order, map hashes, gate chronology, profile epochs, matching bundle and
non-runtime assets, matching browser/host configuration, and identical candidate
packages for enabled/disabled diagnostics. It requires the retained baseline
runtime identities. Captures require distinct guest nonces. Restores retain
the referenced capture identity and are not treated as independent captures.

The analyzer rejects saturated or multi-worker profiles, malformed error
bounds, inconsistent table sample mass, privilege/admission/syscall partitions,
and changing source/protocol identities. Reader counts larger than 2^53 remain
exact decimal strings; they are never coerced through floating-point arithmetic.

Protocol correctness and attribution coverage are separate. Every diagnostic
phase records its PC-addressing revision, known/unknown entry counts and unknown
fraction, and whether PC/edge tables are nonempty. The aggregate coverage status
cannot pass merely because all workload answers matched. Original revision0
runs with all PCREL entries unknown are retained as counter evidence and clearly
marked as having no PC samples. Revision1 resolves target-verified x86 entry PCs;
nonempty tables still do not cover internal same-TB loops or every guest edge.

The three batches per workload are nested observations from one VM launch,
not independent replications. Medians, ranges, raw batches and enabled/off/
baseline ratios are descriptive. No bootstrap, confidence interval, significance
or equivalence claim is computed. Empty-gate calibration is kept visible and
is not subtracted from application elapsed time. Startup markers retain their
original scopes rather than being renamed exclusive boot costs.

PC/edge rows remain per batch so their Space-Saving error bounds stay valid.
Do not sum represented-key estimates across phases: a key can be absent after
replacement, so that sum would not be an upper bound for the combined phase.
The Markdown report shows the first batch for each workload; machine JSON
contains top-20 rows for warmup and all batches, and raw reports retain every
bounded table entry. Address classification uses the initialized map for warmup
and post-warmup map for later batches. Neither address matching nor raw CR3
proves process identity, JIT tier, or code generation.

Helper lists are sampled compiled-import evidence and remain nested inside
execution. Interpretation, helper, emission, translation and suspension scopes
must not be added into an exclusive time decomposition. Generic MMU counters
omit inline TLB hits and some atomic/probe paths. Syscall names come from the
retained x86-64 table; counts are entry attempts, not completions or wait times.
The direct-WASM reference remains a separate component interface, including its
guard/copy costs and differences from the full guest runtime.

Lightweight validation, with no VM or build:

```sh
node benchmarks/harness/analysis/analyze.mjs --self-test
node --test benchmarks/harness/analysis/maps.test.mjs
```

The self-test covers profile consistency and identity rejection. Running the
analyzer on actual successful raw reports is still required before claiming a
completed report. The generated report lists unresolved M1 gates explicitly.
