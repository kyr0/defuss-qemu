# M3a: one existing TB as a region

**Status: proposed only, 7 November 2026.** No region implementation, generated
region execution, or acceptance result is supplied by this document. M1's
[corrected PC/edge campaign](m1-pilot-02.md) establishes repeated cross-block
exposure, and the separate [stopped code inspection](m1-code-inspection-02.md)
matches the original integer recurrence at the dominant pair. Those observations
provide a concrete later multi-block target; this design still begins with one
existing TB and its full recovery/lifetime contract.

The smallest useful M3a change gives an existing translated block an explicit
region identity and execution contract while retaining its current generated
function. It introduces no fusion, retained architectural values across TBs,
alternate memory path, or additional executable cache. The region descriptor
must participate in actual compiled dispatch; a standalone descriptor library
with model tests is not this milestone.

## Existing boundaries that the design retains

| Boundary | Current implementation | M3a contract |
| --- | --- | --- |
| Translation | `tcg_gen_code` in [tcg.c](../../engine/qemu/tcg/tcg.c), `tcg_out_tb_start` / `tcg_out_tb_end` in [tcg-target.c.inc](../../engine/qemu/tcg/wasm64/tcg-target.c.inc) | The existing TCG optimizer, register allocator, TCI stream, WASM function and instruction-search data remain authoritative. |
| Entry | `tcg_qemu_tb_exec`, `get_instance_from_tb` in [wasm64.c](../../engine/qemu/tcg/wasm64.c) | Select the descriptor only after ordinary TB lookup and compiled-instance validation. Preserve hotness/admission decisions and interpreter fallback. |
| Calls and suspension | `call_wasm_tb` in [wasm64.h](../../engine/qemu/tcg/wasm64.h); `tcg_wasm_out_call`, `tcg_wasm_out_handle_unwinding` and shared spill epilogue in the emitter | Preserve `do_init`, `BLOCK_IDX`, the 17-value unwind bank, helper ABI and rewind behavior exactly. |
| Recovery | `encode_search`, `cpu_restore_state_from_tb` in [translate-all.c](../../engine/qemu/accel/tcg/translate-all.c) | Retain the existing instruction-search mapping and target recovery callback. |
| Normal transfer | `tcg_wasm_out_exit_tb`, `tcg_wasm_out_goto`, `tcg_wasm_out_goto_tb` in the emitter | Preserve the returned QEMU TB/exit encoding and `ctx.tb_ptr`. Same-TB branches stay inside the existing function. |
| Invalidation | `do_tb_phys_invalidate`, `tb_invalidate_phys_page_range__locked`, `tb_flush__exclusive_or_serial` in [tb-maint.c](../../engine/qemu/accel/tcg/tb-maint.c) | Depend on the same QEMU TB and physical code pages; create no independent entry or direct link that can outlive their invalidation. |
| Instances | `reserve_instance`, `add_instance`, `remove_old_instances`, `check_gc_completion` in `wasm64.c` | Reuse the existing slot and 12,000-instance limit. Detached instances stay charged until the existing finalization notification. |

The current recovery address is a **TCI code-buffer address**, not an offset
inside dynamically generated WASM. The emitter records `s->code_ptr` through
`ctx.tci_tb_ptr` before ordinary helpers; memory helpers also receive their
existing recovery address. `tcg_gen_code` records TCI instruction-end offsets,
which the search table maps to target instruction-start data. Substituting
WASM byte offsets, a guest PC alone, or a new generic recovery identifier would
lose this contract.

The word “region” also already names QEMU's translation-buffer allocation and
search structures. The proposed execution-region descriptor must not replace
or confuse those structures.

## Bounded descriptor and identity

Add a versioned one-TB descriptor to the existing `WasmTBHeader` allocation.
Its fixed size is included in `tcg_current_code_size` and therefore in the
existing translation-buffer high-water checks. Do not allocate a second
unbounded map keyed by guest PC or TB pointer.

The descriptor records:

- An explicit one-TB kind, descriptor version and translation-generation ID.
- The owning `TranslationBlock`, its translation flags/compile flags and
  original translation PC, with the distinction between fixed and PC-relative
  addressing preserved.
- One member and the existing owner-managed code-page dependencies; a TB can
  cover two physical pages. The owner, rather than copied live-page state,
  remains authoritative for invalidation.
- The existing WASM/import byte ranges, TCI range and the declared recovery
  strategy `qemu-tci-search-v1`. Search-data ownership remains with the TB.
- Eligibility and exclusion reason, sufficient to demonstrate enabled-path
  execution and forced fallback in a stopped diagnostic read.

A raw address is not a generation ID. Initialize the descriptor as unpublished
at TB start, fill it only after successful emission, and expose it only through
the ordinary completed TB publication. The generation must distinguish reused
code-buffer addresses across flush/retranslation and fail closed on exhaustion.
Copy the generation into the existing per-thread instance record when installing
its function; reject mismatched ownership before selecting the descriptor.
Do not retain a descriptor pointer beyond the owning TB's permitted lifetime.

PC-relative TBs can execute through virtual aliases. Their entry PC must follow
the target CPU-state rule, not the recorded translation PC. M1's verified x86
resolver documents the distinction in
[PC-SEMANTICS.md](../../experiments/m1-profile/PC-SEMANTICS.md). Raw CR3 and a
matching address do not establish process or code-generation identity.

## Execution and fallback

Use a separate, disabled-by-default pre-vCPU configuration switch in the
isolated experiment. Keep the retained runtime and normal packaging defaults
unchanged. Initially support only ordinary single-vCPU x86-64 full-system
dynamic translation. Exclude AOT recipes, translation-plan retiering,
single-step/breakpoint modes, exact instruction-count/replay modes, parallel
execution and temporary no-RAM-page TBs until each has explicit fixtures.
Unsupported contexts continue through their existing engine path.

The selected one-TB path calls the same `wasm_tb_func` with the same
`WasmContext` and returns the same result. No extra instruction may run after
an existing helper unwind or exception. Do not convert `ctx.tb_ptr == NULL`
into a successful region completion: it represents several QEMU exit paths.
Do not infer precise guest exit reasons from the scalar return value alone.

Distinguish two failures:

1. An ineligible descriptor on a still-valid ordinary TB uses the existing
   compiled/interpreted path without changing architectural state.
2. An invalidated owner or stale generation must not call its old function as
   “fallback.” Return through QEMU's existing redispatch/retranslation
   mechanism, with the CPU-state synchronization required by `cpu_tb_exec`.
   Its encoded owner and `TB_EXIT_*` semantics need an integration fixture;
   inventing a new return code or returning a code pointer is incorrect.

Keep the existing interrupt checks and dispatcher `trysleep` behavior. M3a
does not change same-TB loops or claim a new service-latency bound. Any later
fusion must preserve service opportunities that would otherwise disappear.

## Lifetime and accounting constraints

One descriptor is an adapter over one existing instance, not another instance.
Count installs and exposure separately from ownership; do not charge twice,
skip admission, change the pool cap or remove pending-GC charges. Report the
descriptor/header overhead and existing emitted-module bytes. A multi-member
cache will require its own byte/dependency limits before M3b/M3c; an entry cap
alone cannot bound arbitrary fused modules.

Do not introduce cleanup that runs only after `call_wasm_tb`: guest exceptions
can leave through QEMU's nonlocal exit path, and suspension resumes through
Asyncify. A new active-reference count would need proven release hooks for
normal returns, exception exits, cancellation and rewind. Avoid such a second
ownership mechanism in M3a. Verify the current single-worker retirement rules
under actual suspension and eviction before extending them.

For one member, existing precise SMC handling identifies the current TB through
its recovery address and forces single-instruction retry where required. This
does **not** establish safety for a future fused region whose store changes a
different, later member. Active-region dependency checks and exact store-commit
recovery are an additional M3b gate.

## Implementation sequence and acceptance evidence

Prepare an isolated overlay using the existing experiment/build pattern; keep
the baseline source/runtime intact. First add the fixed descriptor and
generation initialization at the successful translation boundary. Then connect
selection to both compiled-hit and newly installed dispatch paths and expose
bounded stopped diagnostics. Review existing AOT/header producers so omitted
metadata cannot accidentally look eligible. Finally add owner invalidation and
generation rejection through the established TB lifetime boundaries.

Acceptance requires execution by the actual generated WASM runtime, with
off/on controls from the same candidate build and the retained baseline:

- Run deterministic assembly fixtures above the ordinary promotion threshold,
  verify a nonzero selected-path count, and compare serialized registers,
  flags, memory effects and exit/fault state. The existing short x86 boot smoke
  alone neither forces compiled exposure nor compares complete state.
- Cover taken/untaken exits, same-TB and cross-TB transfers, helper calls,
  page-boundary loads/stores, protection faults after prior committed effects,
  and slow MMU/MMIO paths. Verify the exception PC and exactly-once effects.
- Modify executing code and code reached through a virtual alias; invalidate,
  retranslate and exercise reused translation-buffer and instance slots.
  Assert stale generations do not execute. Include both pages of a split TB.
- Force helper suspension/rewind, request stop/cancellation, apply pool
  pressure and resume. Verify state, retained function reachability, resource
  accounting and eventual cleanup. A host-only lifetime model is supplementary.
- Force every declared exclusion and verify baseline fallback. Cover missing
  or mismatched metadata without treating it as permission to execute stale
  code. Verify a stopped snapshot followed by fresh restore and continuation.
- Run the unchanged pinned Bun workload and existing full-system regressions
  after fixture checks. Keep new frontend claims restricted to targets actually
  built and exercised; x86-64 success does not validate ARM64 or x86-32.

Native descriptor tests can validate bounds and rejection logic, but do not
close recovery, SMC, suspension or invalidation gates. There is no expected
speedup from M3a. A later uninstrumented measurement must quantify overhead;
fusion remains gated on exact hot-edge/code evidence and these correctness
results.
