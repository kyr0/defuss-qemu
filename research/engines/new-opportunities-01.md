# Measured opportunities after the engine investigation

VERIFIED: The new evidence changes the next optimization priority. Admission
deferral and TCI execution deserve investigation before another isolated
instruction lowering. No change in this report is promoted as faster than
RNDS2. The completed [MSG1 timing study](msg1-results-01.md) remains inconclusive.

The diagnostic used the exact retained RNDS2 binary and unchanged Bun guest
in Chrome 157 / V8 15.7. It captured sixteen phases across the page and four
workers: eighty profiles, 279,289 samples, seventy-two checked protocol
records, and successful owned-browser cleanup. The originating linker map
matches the binary's build receipt; 198 exported indexes corroborate its
names. Exactly one observed target contained `cpu_tb_exec`, identifying the
sampled guest execution worker for the comparisons below.

## Observations and their limits

These are percentages of that worker's observed leaf samples across the
three batches of each workload. They are not exclusive CPU-time shares or
potential speedups. `cpu_tb_exec` includes dispatch and inlined general TCI
work, so its samples cannot be assigned wholly to either one.

| Workload | Samples | TCI leaf `defuss63_fast` | `cpu_tb_exec` | `mmu_lookup` plus `mmu_lookup1` | `helper_ld_i128` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Integer | 1,156 | 10.0% | 46.5% | 2.1% | 0.0% |
| JSON | 11,150 | 24.0% | 18.2% | 7.2% | 1.1% |
| SHA | 4,751 | 17.1% | 7.2% | 12.3% | 7.1% |
| HTTP | 11,129 | 38.0% | 18.0% | 7.1% | 0.2% |

VERIFIED: Waiting can masquerade as Wasm activity in this profiler. A separate
known `memory.atomic.wait32` module timed out after 1,500.4 ms and produced
599 waiting-Wasm samples out of 601 worker samples. The VM's futex frames
therefore cannot be called busy CPU consumption merely from these samples.
Background compiler CPU, exact executed tiers, unresolved dynamic-module
hashes and exclusive guest elapsed-cost attribution remain unknown.

## First priority: admission pressure before the hard cap

VERIFIED: In the CPU capture, 9,651 of 12,000 slots were already charged at
the ready gate. The count reached 11,547 by the last workload. In
`engine/qemu/tcg/wasm64.c:372`, the enabled admission policy raises the required
entry count as occupancy rises. With the current 1,500 hot limit, the relevant
thresholds are 6,000 entries at 80%, 24,000 at 90%, and 96,000 at 95% occupancy.
Being below the hard cap does not establish absence of admission pressure.

A separate capture enabled only the existing pressure meter, preserving the
policy, hot limit, pool limit and binary bytes. It recorded 5,565,925
admission-held interpreted intervals and zero hard-cap fallback intervals.
The twelve workload batches contributed:

| Workload | Admission-held intervals | Hard-cap fallback intervals |
| --- | ---: | ---: |
| Integer | 54,039 | 0 |
| JSON | 2,039,954 | 0 |
| SHA | 269,576 | 0 |
| HTTP | 2,591,863 | 0 |

The meter's elapsed counters are retained raw but are not used as exclusive
cost estimates. The two diagnostic captures are separate observations and
their counters and samples are not pooled.

HYPOTHESIS: Some application work stays interpreted because earlier module
admissions consume most of the charged budget. A different admission policy
may outperform RNDS2 without adding region guards or changing SHA arithmetic.
The current observations prove deferral, not that earlier compilation wins.
They also do not prove that earlier modules are stale or safe to evict.

The smallest causal comparison is the existing same-binary admission switch:
flags 3 versus flags 2, with REP batching, the 12,000 cap and all other settings
unchanged. This is a diagnostic candidate, not a proposed default. It needs a
fresh fixed unprofiled study plus compile, eviction, memory and service-latency
checks. Reject it if earlier compilation merely exchanges interpretation for
more compilation, eviction or waiting. A later policy should use observed
module reuse and cost; simply lowering the nominal hot limit is insufficient
because the pressure calculation retains a floor of 1,500.

## Second priority: the surviving interpreter and dispatch path

VERIFIED: `defuss63_fast` is called from the TCI interpreter and executes a
bounded sequence of scalar operations and private-state accesses. It remains
visible after the normal warmup in every workload. The source is
`engine/qemu/tcg/wasm64.c:481`; its caller is at line 601. Integer also shows
substantial samples in the broader `cpu_tb_exec` frame.

HYPOTHESIS: Reducing interpreter register traffic or dispatch work can affect
more application paths than another small SHA expansion. First separate
operation decoding, private register traffic, general TCI and compiled-block
dispatch in a diagnostic with a verified attribution boundary. Inspect the
actual emitted Wasm and host lowering of the observed path. Reject an emitter
change if its component gain does not survive an unchanged-application
comparison. The prior RNDS2 lane experiment does not settle this different
interpreter path.

## Third priority: the compiled SHA guest-load path

VERIFIED: Sampled stacks connect dynamic Wasm blocks through `helper_ld_i128`
to `mmu_lookup` and `mmu_lookup1`. The leaf percentages above are disjoint
samples; inclusive stack totals must not be added to them. The implementation
in `engine/qemu/accel/tcg/cputlb.c:2592` handles page crossing, MMIO, watchpoints,
endianness and atomicity before the sixteen-byte load.

HYPOTHESIS: A cheaper verified same-page RAM fast path, or less repeated
translation work, may benefit SHA and other vector loads. First measure how
often those exact stacks take the ordinary RAM/TLB-hit path and inspect its
generated host code. Keep the existing slow path for faults and exceptional
accesses. Reject the candidate if its useful exposure is small or if the
extra checks erase the application benefit. Host Wasm bounds checks cannot
replace guest MMU semantics.

## Evidence and decision

VERIFIED: No new production optimization was applied. The old plan remains
historical context; new candidate selection now starts with the mechanisms
above and their falsifiers. Full exclusive attribution remains incomplete.

Evidence: [raw CPU capture](../../artifacts/engine-cpu-rnds2-01/report.json),
[mapped profiles](../../artifacts/engine-cpu-findings-01/report.json),
[pressure analysis](../../artifacts/engine-pressure-exposure-01/analysis.json),
[blocking-wait calibration](../../artifacts/engine-cpu-wait-calibration-01/report.json),
[page and worker calibration](../../artifacts/engine-cpu-calibration-02/report.json),
[linker-map provenance](../../artifacts/engine-symbols-rnds2-01/report.json).
The VAE integration check rehashes these captures' bound inputs and the
completed timing study before accepting the current session gate.
