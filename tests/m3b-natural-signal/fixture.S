.text
.globl m3i_invoke
.type m3i_invoke,@function
m3i_invoke:
 pushq %rbp
 pushq %rbx
 pushq %r12
 pushq %r13
 pushq %r14
 pushq %r15
 movq %rsp,m3i_caller_rsp(%rip)
 movq %rdi,m3i_entry(%rip)
 movq m3i_initial+56(%rip),%rsp
 pushq m3i_initial+128(%rip)
 popfq
 movq m3i_initial+0(%rip),%rax
 movq m3i_initial+8(%rip),%rbx
 movq m3i_initial+16(%rip),%rcx
 movq m3i_initial+24(%rip),%rdx
 movq m3i_initial+32(%rip),%rsi
 movq m3i_initial+40(%rip),%rdi
 movq m3i_initial+48(%rip),%rbp
 movq m3i_initial+64(%rip),%r8
 movq m3i_initial+72(%rip),%r9
 movq m3i_initial+80(%rip),%r10
 movq m3i_initial+88(%rip),%r11
 movq m3i_initial+96(%rip),%r12
 movq m3i_initial+104(%rip),%r13
 movq m3i_initial+112(%rip),%r14
 movq m3i_initial+120(%rip),%r15
 pushq $m3i_capture
 jmp *m3i_entry(%rip)
.size m3i_invoke,.-m3i_invoke

/* Side stubs jump here without changing registers/flags. Capture every GPR
 * before using scratch registers or restoring the C call stack. */
.type m3i_capture,@function
m3i_capture:
 movq %rax,m3i_observed+0(%rip)
 movq %rbx,m3i_observed+8(%rip)
 movq %rcx,m3i_observed+16(%rip)
 movq %rdx,m3i_observed+24(%rip)
 movq %rsi,m3i_observed+32(%rip)
 movq %rdi,m3i_observed+40(%rip)
 movq %rbp,m3i_observed+48(%rip)
 movq %rsp,m3i_observed+56(%rip)
 movq %r8,m3i_observed+64(%rip)
 movq %r9,m3i_observed+72(%rip)
 movq %r10,m3i_observed+80(%rip)
 movq %r11,m3i_observed+88(%rip)
 movq %r12,m3i_observed+96(%rip)
 movq %r13,m3i_observed+104(%rip)
 movq %r14,m3i_observed+112(%rip)
 movq %r15,m3i_observed+120(%rip)
 pushfq
 popq m3i_observed+128(%rip)
 movq m3i_caller_rsp(%rip),%rsp
 popq %r15
 popq %r14
 popq %r13
 popq %r12
 popq %rbx
 popq %rbp
 ret
.size m3i_capture,.-m3i_capture


/* New fused sentinel only. Generated churn remains the original ordinary loop. */
.text
.balign 4096,0x90
.globl pressure_sentinel,pressure_sentinel_loop,pressure_sentinel_b
.globl pressure_sentinel_back,pressure_sentinel_side,pressure_sentinel_end
.type pressure_sentinel,@function
pressure_sentinel:
    mov %edi,%ecx
    xor %eax,%eax
pressure_sentinel_loop:
    cmp $0,%ecx
    .byte 0x74
    .byte pressure_sentinel_side-(.+1)
pressure_sentinel_b:
    add %esi,%eax
    sub $1,%ecx
pressure_sentinel_back:
    .byte 0xeb
    .byte pressure_sentinel_loop-(.+1)
pressure_sentinel_side:
    ret
pressure_sentinel_end:
.size pressure_sentinel,.-pressure_sentinel
.section .note.GNU-stack,"",@progbits

.bss
.balign 8
m3i_caller_rsp: .quad 0
m3i_entry: .quad 0
