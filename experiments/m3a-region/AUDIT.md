# Source audit of M3a candidate 04

Audit date: 7 November 2026. This is a source/contract audit, not evidence that
the QEMU build or generated guest execution passed. The frozen candidate is
`artifacts/m3a-source-04/source`, with the nine changed/added file identities in
`artifacts/m3a-source-04/source-m3-overlay.json`. All nine candidate identities
and corresponding baseline identities were rechecked after preparation.

Candidates 01, 02 and 03 are retained. Candidate 02 changes the selector to use an explicit
atomic read of the descriptor-valid flag. Single-vCPU execution does not by
itself exclude invalidation initiated by device/main-loop work, so a plain C
read opposite the atomic invalidation write was insufficient.

Candidate 03 also uses one authoritative CAS word for the enabled choice and
first-dispatch lock. The earlier separate started-check/enabled-store could
accept a concurrent late change. Its configure and lock operations now share
the same atomic comparison, so either configuration precedes locking or it is
rejected. The public enabled/started ABI fields are stopped-read snapshots of
that word. One thousand native concurrent races exercise the same shared loop
with C11 atomics; the production adapter supplies QEMU atomics.

Candidate 04 adds the stopped-only diagnostic companion in
`tcg/m3-region-test.inc`. It uses locked `tcg_tb_foreach` traversals and the
owner's existing `get_info(header, 0)` pointer instead of accessing the main
worker's TLS instance ring. Exactly one eligible CPL3 live owner/current
instance at a watched static PC must match before the second pass changes
only instance generation or descriptor validity. The companion rejects a
running or not-explicitly-stopped CPU, multiple CPUs/contexts, disabled mode,
unbounded/high/unknown ranges and ambiguous candidates. It adds no dispatch
hook or retained pointer. Native compilation of that exact companion with
stand-ins validates mutations and rejection; actual recovery remains a guest
gate until the fixture report exists.

| Contract | Source finding | Remaining execution gate |
| --- | --- | --- |
| Header layout | All `WasmTBHeader` producers/accesses in the baseline were enumerated. Normal emission uses `sizeof` and field addresses; generated context accesses use `offsetof`. The AOT path checks the computed prefix and zeroes that full prefix. | Successful SDK build, boot and both compiled hit/fresh-install paths. |
| Complete publication | Descriptor creation follows successful `tcg_out_tb_end`; ordinary `tb_gen_code` still encodes search data, initializes jumps, inserts the lookup tree, and publishes through its existing page-link path. Failed/restarted translations are not published. | Translation overflow/retry and cache-flush stress under the actual runtime. |
| PC-relative identity | Ordinary QEMU lookup remains authoritative. `x86_cpu_synchronize_from_tb` explicitly preserves the already-current EIP for PC-relative blocks. `gen_jmp_rel` updates it before direct transfer. Watch observations additionally require the translated page offset to match. | Nonzero selected counts in the fixture's own ranges, zero watch-PC mismatches, and virtual-alias coverage. |
| Guest state and recovery | No TCG operation, generated instruction sequence, CPU-state store, helper call, recovery address, instruction-search offset rule or target restore callback is changed. The bigger header is naturally included in existing TCI offsets. | Full state/flags/memory comparisons, exact fault RIP and effects committed before the fault. |
| Invalid owners | `do_tb_phys_invalidate` still sets `CF_INVALID`, unlinks hashes/jumps and preserves the original precise-SMC path. Its new callback atomically clears only the owned descriptor's validity. Selection reads validity and `tb_cflags` atomically. | Active-TB SMC, alias SMC, stale-entry/retranslation fixtures; the defensive redispatch branch needs direct evidence if claimed exercised. |
| Requested exit | Defensive redispatch uses the existing `wasm44_retier` pattern: look up the TB by its code address, invalidate a still-valid conflicting owner, request `cpu_exit`, and return the encoded TB owner with `TB_EXIT_REQUESTED`. `cpu_tb_exec` performs the target synchronization; the exit request prevents the icount-only assertion path. | A forced stale/invalid descriptor entry in a real generated runtime, not only native decision tests. |
| Admission and fallback | Original counter thresholds, compiled-hit priority, reservation, held interpretation and retiering stay in place. Generation mismatch uses the existing missing-instance/reinstantiation path. All selected and fallback calls use the original `wasm_tb_func`/`WasmContext`. | Demonstrated selected and excluded-mode execution; remaining debug/icount/AOT/multi-context exclusions must not be called validated without their own runs. |
| Instance lifetime | No new executable object or function-table link is created. Original instance retirement and pending-GC capacity charging remain. A generation field is copied into the existing slot and cleared at retirement. | Pool pressure/retirement, stale-slot reuse and cleanup, including suspended continuation. |
| Nonlocal exits and Asyncify | The wrapper has no after-call cleanup or reference count. Original `do_init`, `BLOCK_IDX`, unwind spill bank and indirect-call signature remain. Pre-call diagnostics count attempts rather than completions. | Fault exits and real helper suspension/rewind, with stop/continue and exact state/effect checks. |
| Resource bounds | Descriptor storage is inside the existing bounded translation buffer. The existing fixed instance array gains one uint64 per slot; diagnostics are 384 bytes plus one generation counter. No additional map/cache/allocation is introduced. Emission-byte counters are cumulative rather than resident-byte accounting. | Runtime-reported sizes, bounded pool behavior and observed overhead. Future fusion still needs explicit module-byte/dependency budgets. |

The native ASan/UBSan and C/JS ABI report is
`artifacts/m3a-native-04.json`. It covers shared selection decisions,
owner/generation/validity rejection, eligibility, saturation, fixed storage,
reader partitions, watch configuration validation, configure/lock races and
the exact exported test-companion mutation/rejection boundaries with native
stand-ins. It cannot establish any
of the execution gates in the table.

M3a does not provide typed inter-TB effects, architectural-state retention,
multi-member recovery, active future-member SMC checks, expanded service
budgets, or ARM64/x86-32 region execution. Those remain later work. A successful
one-TB fixture would establish a tested infrastructure boundary, not a speedup
or completion of the full region milestone sequence.
