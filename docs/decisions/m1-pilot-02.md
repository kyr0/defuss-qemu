# M1 pilot 02: corrected PC and edge exposure

Status: exploratory evidence, 7 November 2026. Candidate 02 resolves the
PC-relative entry-address gap from [pilot 01](m1-pilot-01.md). No production
optimization or performance improvement is selected by this report. M1's
exclusive-time and exact JIT-code attribution gates remain incomplete.

The next justified step is bounded code-byte capture for the observed integer
backedges, followed by the one-TB recovery/invalidation scaffold. The sampled
addresses already establish repeated cross-block exposure; they do not yet
establish a particular JSC tier or authorize region fusion.

## Retained evidence

- [Triplet analysis](../../artifacts/m1-analysis-02/REPORT.md) and
  [complete per-batch data](../../artifacts/m1-analysis-02/analysis.json).
- [Restore/sampling sensitivity](../../artifacts/m1-sensitivity-02/REPORT.md)
  and [per-key bounds](../../artifacts/m1-sensitivity-02/analysis.json).
- [Independent review](../../artifacts/m1-analysis-02/independent-review.json):
  70,494 checks and 91 rehashed files, including all 62 frozen campaign inputs;
  independently recomputed medians, ratios, sample mass, partitions, bounds,
  original answers, and capture/restore identity with a Python stdlib script.
- [Static Bun PC inspection](../../artifacts/m1-bun-inspection-02/report.json):
  12 selected file-backed PCs, archive/member hashes, exact PT_LOAD offsets,
  byte windows and disassembly. This does not capture live JIT code.
- [Frozen campaign inputs](../../artifacts/m1-runs/inputs-v2.json),
  [frozen analyzer inputs](../../artifacts/m1-analysis-source-02.json), and
  [crash-resumption record](../../artifacts/m1-runs/resumption-2026-11-07.json).

| Run | Raw report SHA256 |
| --- | --- |
| [baseline-02-resumed-02](../../artifacts/m1-runs/baseline-02-resumed-02/report.json) | `cf77ce7b8ccaddb143174aff326a24ebabe19b6fc203d6b7261b640ababa6244` |
| [off-02](../../artifacts/m1-runs/off-02/report.json) | `5904c4220aa6fa7cfbdcb7d37344579d6e6a1e635b858d7667d8354942f1fcaa` |
| [on-02](../../artifacts/m1-runs/on-02/report.json) | `bd8f97af7228fb5a00112a68c0bb05bfe788aa975bf5f7222ba53a63a2377684` |
| [on-restore-263-02](../../artifacts/m1-runs/on-restore-263-02/report.json) | `fc0e04d792e1cbfc25f4a6c0f1e2fb646e7f42b6c195133b901ee7ce8d6f70cb` |

The interrupted `baseline-02` directory and the failed localhost-sandbox launch
`baseline-02-resumed` are retained separately. The analysis uses the successful
fresh baseline named above. There are three independent captures and one
dependent restore: 48 measured 100-call batches, or 4,800 measured calls, plus
the fixed warmups. Every workload answer and protocol check passed.

Both enabled runs have addressing revision 1, zero unknown-PC entries, nonempty
PC/edge tables and no saturation or unsupported-worker observations in all 13
phases apiece (warmup plus 12 measured batches). This is observed-entry coverage,
not coverage of internal same-TB iterations or every possible guest edge.

## Instrumentation perturbation remains material

Host medians below are milliseconds per 100 calls. Each median describes three
nested batches from one launch. Greater on/off ratios mean slower execution;
these are descriptive ratios, with no confidence interval or equivalence claim.

| Workload | Retained baseline | Diagnostic off | Diagnostic on | On / off |
| --- | ---: | ---: | ---: | ---: |
| Integer | 426.310 | 530.780 | 889.860 | 1.677 |
| JSON | 3129.005 | 3355.150 | 4820.795 | 1.437 |
| SHA256 | 2220.640 | 2327.215 | 3251.020 | 1.397 |
| HTTP | 4074.310 | 4119.945 | 5004.180 | 1.215 |

On/off enables the entire diagnostic suite, not just PC sampling. Off/baseline
also compares rebuilt and retained runtime artifacts. Individual batches remain
visible in the raw analysis: for example, enabled JSON is 8173.560 / 4188.160 /
4820.795 ms, and disabled HTTP is 4119.945 / 3598.470 / 5667.865 ms. These are
not stationary or independently replicated observations.

Empty-gate calibration has not been subtracted. Counters include the tail
between result receipt and confirmed stop; the host endpoint excludes that
tail. Existing execution/helper/translation timers overlap and may include
suspension. No exclusive CPU-time breakdown follows from this table.

## Integer: a dominant pair of observed backedges

The capture's two dominant compiled user PCs are `0x7f70b7d96f49` and
`0x7f70b7d96f68`, in an anonymous executable mapping. Both directed edges occur
among the dominant sampled transitions in all three integer batches. Their
two largest PC rows account for 97.956%, 98.804% and 99.068% of the respective
deterministic PC sample streams. These percentages are neither elapsed-time
fractions nor estimates of instruction retirement.

In batch 0, the directed edge lower–upper bounds are 97,278–97,278 samples
(`...6f49` → `...6f68`) and 97,269–97,269 (`...6f68` → `...6f49`). Equal bounds
mean no table-replacement uncertainty for those represented keys, not an
absence of deterministic-sampling bias. Compiled entry counts remain near
50 million per batch for 25 million recurrence iterations.

The period-263 restore again exhibits a dominant two-address compiled pattern,
at `0x7f70b7d97669` and `0x7f70b7d97688`. Its two largest PC rows account for
97.963%, 99.269% and 99.231% of the sampled PC streams. **Those are different
addresses.** The sensitivity report keeps the old keys absent/unknown, rather
than merging them or asserting identical machine code. This is consistent
with the structural hypothesis but does not establish an exact code identity.

The restored snapshot is application-ready, before the warmup; each launch
runs its own warmup/workload sequence from that state. Shared capture identity
does not make subsequent guest/host JIT evolution identical. Sampling-period
effects cannot be isolated from those differences by this one restore.

Next: capture bounded live bytes while stopped, with exact context/mapping and
capture-phase provenance. Validate the recurrence and branch boundaries from
those bytes, then introduce one-TB region metadata/recovery before considering
fusion. Preserve service checks, code invalidation and fallback throughout.

## SHA, JSON and HTTP targets

The exact distroless archive has SHA256
`6e0c7ba5c87f423422ef4d5cc04f9d089ef9270c602567a8bb06b05902f635f4`;
its extracted Bun member has SHA256
`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`.
The SHA phase's hot file-backed PCs include `0x2391cc0` and `0x2391df5`.
Their retained disassembly contains `movdqu`, `pshufb`, `sha256rnds2`,
`sha256msg1` and `sha256msg2`. Together with the helper census this makes exact
SHA schedule lowering and 128-bit transfer work concrete narrow candidates.
No containing function symbol, guest ABI or bulk-substitution boundary has
been established, and archive bytes are not a live-memory integrity check.

JSON's hot file-backed `0x201159e` decodes an increment/compare/backedge. That
window alone does not identify a parser, allocation routine or byte scanner.
Its enabled batch-0 charged pool grows from 10,583 to 11,236; later batches
start at 11,400/11,402 and install no further net charged instances. Keep the
admission pressure and existing 128-bit/helper exposure as separate hypotheses.
The scalar inline-TLB-hit fraction is still unmeasured.

HTTP's kernel-entry fractions are 62.947%, 65.460% and 67.823%; interpreted
entries exceed compiled entries in all three batches. These are entry
fractions. Admission-held observations are 13,778,931 / 14,884,523 / 17,136,789.
This supports investigating interpreter/admission behavior and adding bounded
wait/wakeup/completion timing. It does not measure blocked time or select a
scheduler rewrite. The workload remains guest loopback with no virtual NIC.

## Decision and remaining gates

1. Capture and verify the integer code bytes; validate the one-TB scaffold's
   state, recovery, accounting and invalidation before a two-block experiment.
2. Develop independently selectable exact SHA schedule/128-bit candidates with
   arbitrary-input, fault, alias and fallback fixtures, using the demonstrated
   instruction/helper exposure. An unchanged-Bun bulk replacement still needs
   a verified ABI or explicit cooperation.
3. Improve HTTP suspension/wakeup attribution and memory-path exposure where
   the proposed optimization depends on those missing cost fractions.
4. Screen any resulting candidate uninstrumented, retain all batches, and
   perform fresh paired confirmation only after freezing a selected design.

The corrected profiler has resolved pilot 01's empty PC/edge tables. Exact JIT
code identity, complete instruction/memory census, exclusive time attribution,
startup phase profiles, and cross-architecture coverage remain open. Standalone
WASM references retain their component-only scope. No region compiler,
integrated SHA replacement, Linux application profile, or production speedup
has been validated by this pilot.
