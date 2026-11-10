# M3b candidate scope: bounded conditional fallthrough

**Status: source-grounded proposal, not implemented or validated.** Begin only
after the real M3a fixtures establish the one-TB entry/recovery/lifetime
boundary. The [captured integer loop](m1-code-inspection-02.md) supplies an
actual target: a 31-byte conditional body A and a 9-byte backedge B, nine guest
instructions in one page. No address, arithmetic constant, seed, iteration
count or checksum should be encoded into the optimizer.

A generic conditional-fallthrough extension is the smallest credible first
candidate. Translate contiguous A+B as one QEMU TB, preserving the existing
decoder, TCG operations, one owner, instruction-search table and physical code
dependency. This is narrower than concatenating independently emitted WASM
modules, and avoids inventing relocation/recovery ownership for two old code
buffers. A separately reached B can still have its own ordinary TB; QEMU's
existing overlapping-TB invalidation must invalidate both as needed.

## Initial admitted shape

- Single-vCPU x86-64 full system, CPL3 long-mode PC-relative code; no debug,
  instruction-count/replay, breakpoint, interrupt-shadow, resume-flag, AOT or
  translation-plan modes. Preserve M3a's independent off switch.
- One conditional side exit followed by a contiguous fallthrough block that
  ends in a direct unconditional backedge to the region entry. Initially require
  the conditional target to be the address immediately after that backedge.
- At most two basic blocks, 32 guest instructions and 128 source bytes, wholly
  within one ordinary executable RAM page. Respect a smaller original
  `max_insns`/`CF_COUNT_MASK` limit. A candidate that cannot fit falls back.
- Integer register/immediate instructions from an explicit nontrapping decoder
  allowlist, with their existing QEMU lowering. Reject any operand with
  `X86DecodedOp.has_ea`, calls/returns/indirect branches, system/segment/debug
  operations, memory operations, atomics, floating point, SIMD and unknown
  effects. Also reject unexpected helper calls or guest-memory TCG operations
  in the completed proposed IR, including helpers emitted by flag handling.
- The initial benchmark profile must have no independent device/DMA writer to
  executable guest RAM. A register-only admitted loop cannot itself modify
  code or suspend through a helper. Guest threads can modify it after an
  interrupt/service exit; reentry must use normal invalidation/lookup.

This contract covers the observed shift/XOR/multiply/add/increment/compare
loop while also accepting other arbitrary register values, constants and
trip counts. A held-out suite must exercise those variations and unrelated
matching loop programs, plus excluded shapes that take the reference path.

## Concrete frontend change

The insertion point is `gen_Jcc` in
[`emit.c.inc`](../../engine/qemu/target/i386/tcg/emit.c.inc), with bounded
per-translation state in `DisasContext` and final shape/effect validation before
`tcg_gen_code`. Currently `gen_Jcc` uses `gen_jcc` followed by
`gen_conditional_jump_labels`, which ends both paths through `gen_jmp_rel`.
The candidate instead emits an inverted condition around the original taken
exit, restores the continuing frontend state, and lets `translator_loop`
decode the fallthrough instruction.

Preserve the existing `gen_prepare_cc` / `gen_update_cc_op` ordering.
`gen_jcc` can change the lazy flag representation while preparing a condition;
the continuing state must be saved **after** that preparation. Side-exit
generation can alter `base.is_jmp`, `pc_save`, `cc_op` and `cc_op_dirty`. Restore
the state appropriate to fallthrough before continuing, without discarding any
flag computation required on both paths. Do not copy `DisasContext` blindly:
it contains temporary/label references and a `sigjmp_buf`.

Two particular pitfalls are visible in the current source:

1. `gen_JMP` normally uses jump slot 0. The original Jcc taken exit also uses
   slot 0. The closing backedge must use slot 1, with at most one use of each
   slot; otherwise jump reset offsets and invalidation links collide.
2. With `CF_PCREL`, the runtime EIP and `pc_save` are a paired representation.
   An exit-only update must not leave the continuing compile path assuming EIP
   was updated. Emit precise EIP/flag materialization on each service/side exit
   and restore the continuing bookkeeping. Same-page membership preserves
   instruction-search page-relative interpretation; it does not excuse an
   incorrect `pc_save` delta.

All nine original `insn_start` records must remain in source order. The normal
`translator_loop` must produce the combined byte span and instruction count;
ordinary `encode_search` and target `restore_state_to_opc` remain authoritative.
Do not treat emitted WASM offsets as recovery addresses.

## Rejection and translation retry

A partial speculative IR is not an acceptable fallback. If the second block
has an unsupported operation, shape, size, extra exit, unexpected helper or
decode failure, discard the entire attempted translation and retranslate the
original entry once with extension disabled. Bound this to one attempt and one
ordinary retry; retain the original instruction limit.

`tcg_func_start` resets the temporary pool, constants, operation/label lists and
debug jump-slot issue mask. The retry belongs before emission/publication and
must preserve the owning TB's page lock and CPU translation context. A target
wrapper around `x86_translate_code` is possible, but needs a fixture for every
failure/retry path and a review of translation side effects. Do not overload
the existing `-3` return: it specifically means page-lock-order retry. Do not
speculatively read a second page merely to decide eligibility; ensure each
lookahead instruction's maximum bytes fit within the first page before decode.

## Service boundaries and bounded execution

Joining A+B would otherwise remove B's `gen_tb_start` interrupt check. Emit an
equivalent pending-exit check at the internal B boundary, with exact state at
B on its exit. Retain the original A-entry check. A descriptor-invalid check
at the same internal boundary can reject changed code before B, but is not by
itself a proof for unrestricted concurrent DMA/other-vCPU writes; the initial
scope excludes them.

The existing WASM `tcg_wasm_out_goto` detects a branch to its own TB and loops
inside the generated function. Therefore a combined A+B would also skip the
outer dispatcher's `trysleep` opportunities. Add a finite traversal budget
(an initial exploratory choice is 256 completed backedges). On exhaustion,
materialize the exact next A state and return to the existing execution
service boundary. Record the actually suppressed dispatch turns so service
accounting advances by equivalent work rather than counting a 256-iteration
region as one ordinary turn. This needs an explicit contract for interruption,
early conditional exit and budget exit; it must not turn into a recursive
WASM call chain.

The register-only/no-helper contract avoids an internal Asyncify continuation,
but budget and interrupt exits still require state equality. Tests must request
stop at both logical member boundaries and during a long-running loop, retain
host-clock response times, and verify exact continuation. A finite loop's
checksum alone does not demonstrate responsive service.

## State retention is a distinct change

This frontend extension can eliminate cross-function dispatch while retaining
all existing materialization. It does **not** automatically retain all guest
registers in locals across the conditional boundary:
`tcg_reg_alloc_cbranch` syncs globals, and `tcg_reg_alloc_bb_end` saves them at
labels/basic-block ends. Those rules are explicit in
[`tcg.c`](../../engine/qemu/tcg/tcg.c).

First preserve those rules and measure dispatch reduction. Removing their
stores/reloads requires an additional liveness/recovery contract for each
observer, including lazy flags at B's service exit and A's next entry. Report
the initial result as bounded dispatch fusion, not completed architectural-state
retention or the full M3b exit gate. Inspect emitted code and measured state
traffic before deciding how much that second change can add.

## Acceptance and decision

Before performance screening, actual generated-code tests must cover both
Jcc outcomes, arbitrary seeds/constants/trip counts, direct entry into B,
state/flags on conditional and budget exits, both interrupt boundaries,
virtual-alias code replacement, pause/change/reentry, translation rejection and
retry, and descriptor/instance retirement. Faulting memory, helpers, MMIO,
debug/icount and unsupported-mode examples must demonstrably use the existing
path. A valid two-block fixture needs nonzero candidate exposure in its own
range, not merely compiled kernel traffic.

For the unchanged Bun workload, demonstrate that the measured A/B shape was
selected, fewer compiled-function/dispatcher entries occurred, every original
answer and snapshot continuation passed, and instance/code/compile/service
budgets held. Then compare an uninstrumented candidate against a fixed control
with fresh independent runs. Keep diagnostic overhead, first-use translation
retry cost and all negative/neutral results visible. Promotion still requires
held-out programs and a separately frozen confirmation; no speed multiplier is
implied by the captured two-entry shape.
