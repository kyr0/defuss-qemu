/* Source-only Linux x86-64 fixture; no build or execution has occurred. */
.text
/* One caller at a time. The fixture does not install asynchronous guest handlers. */
.globl mbnd_invoke
.type mbnd_invoke,@function
mbnd_invoke:
 pushq %rbp
 pushq %rbx
 pushq %r12
 pushq %r13
 pushq %r14
 pushq %r15
 movq %rsp,mbnd_caller_rsp(%rip)
 movq %rdi,mbnd_entry(%rip)
 fxsave64 mbnd_fp_before(%rip)
 movq mbnd_initial+56(%rip),%rsp
 pushq mbnd_initial+128(%rip)
 popfq
 movq mbnd_initial+0(%rip),%rax
 movq mbnd_initial+8(%rip),%rbx
 movq mbnd_initial+16(%rip),%rcx
 movq mbnd_initial+24(%rip),%rdx
 movq mbnd_initial+32(%rip),%rsi
 movq mbnd_initial+40(%rip),%rdi
 movq mbnd_initial+48(%rip),%rbp
 movq mbnd_initial+64(%rip),%r8
 movq mbnd_initial+72(%rip),%r9
 movq mbnd_initial+80(%rip),%r10
 movq mbnd_initial+88(%rip),%r11
 movq mbnd_initial+96(%rip),%r12
 movq mbnd_initial+104(%rip),%r13
 movq mbnd_initial+112(%rip),%r14
 movq mbnd_initial+120(%rip),%r15
 jmp *mbnd_entry(%rip)
.size mbnd_invoke,.-mbnd_invoke

/* Side stubs jump here without changing registers/flags. Capture every GPR
 * before using scratch registers or restoring the C call stack. */
.type mbnd_capture,@function
mbnd_capture:
 movq %rax,mbnd_observed+0(%rip)
 movq %rbx,mbnd_observed+8(%rip)
 movq %rcx,mbnd_observed+16(%rip)
 movq %rdx,mbnd_observed+24(%rip)
 movq %rsi,mbnd_observed+32(%rip)
 movq %rdi,mbnd_observed+40(%rip)
 movq %rbp,mbnd_observed+48(%rip)
 movq %rsp,mbnd_observed+56(%rip)
 movq %r8,mbnd_observed+64(%rip)
 movq %r9,mbnd_observed+72(%rip)
 movq %r10,mbnd_observed+80(%rip)
 movq %r11,mbnd_observed+88(%rip)
 movq %r12,mbnd_observed+96(%rip)
 movq %r13,mbnd_observed+104(%rip)
 movq %r14,mbnd_observed+112(%rip)
 movq %r15,mbnd_observed+120(%rip)
 pushfq
 popq mbnd_observed+128(%rip)
 fxsave64 mbnd_fp_after(%rip)
 movq mbnd_caller_rsp(%rip),%rsp
 popq %r15
 popq %r14
 popq %r13
 popq %r12
 popq %rbx
 popq %rbp
 ret
.size mbnd_capture,.-mbnd_capture

/* Two generic register/immediate loops; no boundary selector in guest code. */
.balign 4096,0x90
.globl mbnd_add32,mbnd_add32_b,mbnd_add32_back,mbnd_add32_side,mbnd_add32_end
.type mbnd_add32,@function
mbnd_add32:
 cmpl $0,%ecx
 .byte 0x74
 .byte mbnd_add32_side-(.+1)
mbnd_add32_b:
 addl $53,%eax
 xorl %edx,%eax
 subl $1,%ecx
mbnd_add32_back:
 .byte 0xeb
 .byte mbnd_add32-(.+1)
mbnd_add32_side:
 jmp mbnd_capture
mbnd_add32_end:
.size mbnd_add32,.-mbnd_add32

.balign 4096,0x90
.globl mbnd_add64,mbnd_add64_b,mbnd_add64_back,mbnd_add64_side,mbnd_add64_end
.type mbnd_add64,@function
mbnd_add64:
 cmpq $0,%r9
 .byte 0x74
 .byte mbnd_add64_side-(.+1)
mbnd_add64_b:
 xorq %r13,%r10
 addq $17,%r10
 subq $1,%r9
mbnd_add64_back:
 .byte 0xeb
 .byte mbnd_add64-(.+1)
mbnd_add64_side:
 jmp mbnd_capture
mbnd_add64_end:
.size mbnd_add64,.-mbnd_add64

.bss
.balign 8
mbnd_caller_rsp: .quad 0
mbnd_entry: .quad 0
.section .note.GNU-stack,"",@progbits
