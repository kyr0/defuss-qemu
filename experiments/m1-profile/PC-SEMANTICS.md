# PC-relative entry attribution, revision1

The original diagnostic candidate had no usable x86 PC/edge tables because
system-mode x86 enables `CF_PCREL` in
[`x86_cpu_realizefn`](../../engine/qemu/target/i386/cpu.c:10075).
Conservatively omitting that flag excluded all observed entries. Successful
workload execution established counter operation, not PC coverage.

Revision1 uses the target's dynamic entry-PC contract. It does not infer a
virtual address from a physical page or a stale translation-time page.

1. [`x86_get_tb_cpu_state`](../../engine/qemu/target/i386/tcg/tcg-cpu.c:51)
   obtains a new TB lookup key from `env->eip` in 64-bit code; CS.base is ignored.
   Otherwise it computes `(uint32_t)(CS.base + env->eip)`. Legacy addresses wrap
   to32bits, including segmented real and VM86 execution.
2. [`x86_cpu_synchronize_from_tb`](../../engine/qemu/target/i386/tcg/tcg-cpu.c:70)
   explicitly documents that EIP is current with `CF_PCREL`; only non-PCREL
   blocks need their PC restored from the TB. This is an entry/boundary
   guarantee, not an instruction-level sampling guarantee.
3. [`gen_jmp_rel`](../../engine/qemu/target/i386/tcg/translate.c:2048)
   applies the PC-relative update to the `cpu_eip` TCG global **before** emitting
   `goto_tb`. It applies width masking when needed. Indirect jumps write
   `cpu_eip` through `gen_op_jmp_v`; fallthrough exits update it before leaving.
4. [`goto_tb` and `goto_ptr`](../../engine/qemu/include/tcg/tcg-opc.h:115)
   have `TCG_OPF_BB_EXIT`. The liveness pass calls
   [`la_func_end`](../../engine/qemu/tcg/tcg.c:3691), marking globals synchronized
   to canonical memory, including the EIP global defined in
   [`translate.c`](../../engine/qemu/target/i386/tcg/translate.c:3441).
   Both TCI and WASM are emitted from these synchronized operations.
5. The interpreter observes a target only after the source block's emitted
   state stores and branch have executed. The compiled WASM path likewise
   returns with `ctx.tb_ptr` set to the next TB after those stores. Same-TB
   compiled loops stay inside the WASM function and remain unobserved; they
   do not add synthetic entries.
6. The existing [`helper_lookup_tb_ptr`](../../engine/qemu/accel/tcg/cpu-exec.c:380)
   also relies on this live state via `get_tb_cpu_state`. QEMU's PCREL logging
   uses the CPU PC rather than `tb->pc` for the same reason.

At the existing compiled/TCI entry hooks, the adapter therefore uses exactly
the formula in item1. It verifies that its low target-page bits equal those
of the original translation PC. A TB reused through another virtual mapping
can change its virtual page; its physical page offset remains the same. This
independent check rejects an inconsistent/stale boundary state as unknown.
It cannot prove every possible corruption that preserves the low page bits;
the frontend/TCG synchronization contract remains necessary.

For non-PCREL TBs, the adapter keeps the translation-time PC because EIP need
not be synchronized there. AOT replay is rejected from PC tables because its
header construction does not fill the added metadata. Other architectures'
PCREL rules are not assumed. Unknown entries break observed edge chains.
CR3 and translation flags remain context hints, not a unique process or code
generation identity.

The portable C resolver is tested with:

- Multiple virtual aliases for one translation-time page/offset, preserving
  distinct recorded PCs and mixed interpreted/compiled edges.
- High 64-bit addresses and a nonzero ignored CS.base in64-bit code.
- Legacy32-bit addition/wrapping, segmented VM86 and real-mode reset addresses.
- An EIP page-offset mismatch, which becomes unknown and breaks the edge.
- A stale EIP on a non-PCREL block, which retains its correct metadata PC.
- Zeroed AOT metadata, which remains unknown rather than PC0/real-mode.

Native ASan/UBSan fixtures verify the resolver and table contract. They do not
prove generated guest exposure. Fresh guest reports must separately show
revision1, nonempty PC/edge tables, and an acceptable unknown-PC fraction before
being used for attribution. Historical revision0 reports remain valid exposure
counter data with unavailable PC attribution.
