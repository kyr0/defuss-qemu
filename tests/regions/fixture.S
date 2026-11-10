.text
.macro save_fault_registers
    pushfq
    popq 16(%rsi)
    mov %rax,24(%rsi)
    mov %rbx,32(%rsi)
    mov %rcx,40(%rsi)
    mov %rdx,48(%rsi)
    mov %rsi,56(%rsi)
    mov %rdi,64(%rsi)
    mov %rbp,72(%rsi)
    mov %rsp,80(%rsi)
    mov %r8,88(%rsi)
    mov %r9,96(%rsi)
    mov %r10,104(%rsi)
    mov %r11,112(%rsi)
    mov %r12,120(%rsi)
    mov %r13,128(%rsi)
    mov %r14,136(%rsi)
    mov %r15,144(%rsi)
.endm
.globl region_state
.type region_state,@function
region_state:
    mov %edi,%eax
    xor %esi,%eax
    imul $1664525,%eax,%eax
    mov %eax,4(%rdx)
    add $1013904223,%eax
    pushfq
    pop %rcx
    mov %eax,(%rdx)
    mov %rcx,8(%rdx)
    movd %eax,%xmm0
    pshufd $0,%xmm0,%xmm0
    movdqu %xmm0,16(%rdx)
    ret
.globl region_state_end
region_state_end:
.size region_state,.-region_state

.globl region_load,region_load_fault,region_load_after
.type region_load,@function
region_load:
    incq (%rsi)
    movabs $0x0123456789abcdef,%rax
    movabs $0xfedcba9876543210,%r10
    xor %r11d,%r11d
    save_fault_registers
region_load_fault:
    movq (%rdi),%r10
region_load_after:
    mov %r10,8(%rsi)
    ret
.size region_load,.-region_load

.globl region_store,region_store_fault,region_store_after
.type region_store,@function
region_store:
    incq (%rsi)
    movabs $0x0123456789abcdef,%rax
    movabs $0xfedcba9876543210,%r10
    xor %r11d,%r11d
    save_fault_registers
region_store_fault:
    movq %r10,(%rdi)
region_store_after:
    mov %r10,8(%rsi)
    ret
.globl region_store_end
region_store_end:
.size region_store,.-region_store

.globl region_loop,region_loop_start,region_loop_end
.type region_loop,@function
region_loop:
    mov %edi,%eax
    xor %ecx,%ecx
region_loop_start:
    xor %ecx,%eax
    imul $1664525,%eax,%eax
    add $1013904223,%eax
    inc %ecx
    cmp %esi,%ecx
    jb region_loop_start
region_loop_end:
    ret
.size region_loop,.-region_loop

/* Blocking Linux read with callee-saved state live over syscall suspension. */
.globl region_suspend
.type region_suspend,@function
region_suspend:
    push %r12
    push %r13
    push %r14
    push %r15
    sub $16,%rsp
    movabs $0x123456789abcdef0,%r12
    movabs $0x23456789abcdef01,%r13
    movabs $0x3456789abcdef012,%r14
    movabs $0x456789abcdef0123,%r15
    xor %eax,%eax
    mov %rsp,%rsi
    mov $1,%edx
    syscall
    cmp $1,%rax
    jne 1f
    cmpb $75,(%rsp)
    jne 1f
    movabs $0x123456789abcdef0,%rax
    cmp %rax,%r12
    jne 1f
    movabs $0x23456789abcdef01,%rax
    cmp %rax,%r13
    jne 1f
    movabs $0x3456789abcdef012,%rax
    cmp %rax,%r14
    jne 1f
    movabs $0x456789abcdef0123,%rax
    cmp %rax,%r15
    jne 1f
    mov $1,%eax
    jmp 2f
1:  xor %eax,%eax
2:  add $16,%rsp
    pop %r15
    pop %r14
    pop %r13
    pop %r12
    ret
.globl region_suspend_end
region_suspend_end:
.size region_suspend,.-region_suspend
.section .note.GNU-stack,"",@progbits
