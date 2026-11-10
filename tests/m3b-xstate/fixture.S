/* Extended-state derivative; parent program byte shapes are unchanged. */
.text
/* One caller at a time. The fixture does not install asynchronous guest handlers. */
.globl m3b_invoke
.type m3b_invoke,@function
m3b_invoke:
 pushq %rbp
 pushq %rbx
 pushq %r12
 pushq %r13
 pushq %r14
 pushq %r15
 movq %rsp,m3b_caller_rsp(%rip)
 movq %rdi,m3b_entry(%rip)
 movl m3x_mask(%rip),%eax
 xorl %edx,%edx
 xsave64 m3x_original(%rip)
 xrstor64 m3x_seed(%rip)
 xsave64 m3x_before(%rip)
 fxsave64 m3b_fp_before(%rip)
 movq m3b_initial+56(%rip),%rsp
 pushq m3b_initial+128(%rip)
 popfq
 movq m3b_initial+0(%rip),%rax
 movq m3b_initial+8(%rip),%rbx
 movq m3b_initial+16(%rip),%rcx
 movq m3b_initial+24(%rip),%rdx
 movq m3b_initial+32(%rip),%rsi
 movq m3b_initial+40(%rip),%rdi
 movq m3b_initial+48(%rip),%rbp
 movq m3b_initial+64(%rip),%r8
 movq m3b_initial+72(%rip),%r9
 movq m3b_initial+80(%rip),%r10
 movq m3b_initial+88(%rip),%r11
 movq m3b_initial+96(%rip),%r12
 movq m3b_initial+104(%rip),%r13
 movq m3b_initial+112(%rip),%r14
 movq m3b_initial+120(%rip),%r15
 jmp *m3b_entry(%rip)
.size m3b_invoke,.-m3b_invoke

/* Side stubs jump here without changing registers/flags. Capture every GPR
 * before using scratch registers or restoring the C call stack. */
.type m3b_capture,@function
m3b_capture:
 movq %rax,m3b_observed+0(%rip)
 movq %rbx,m3b_observed+8(%rip)
 movq %rcx,m3b_observed+16(%rip)
 movq %rdx,m3b_observed+24(%rip)
 movq %rsi,m3b_observed+32(%rip)
 movq %rdi,m3b_observed+40(%rip)
 movq %rbp,m3b_observed+48(%rip)
 movq %rsp,m3b_observed+56(%rip)
 movq %r8,m3b_observed+64(%rip)
 movq %r9,m3b_observed+72(%rip)
 movq %r10,m3b_observed+80(%rip)
 movq %r11,m3b_observed+88(%rip)
 movq %r12,m3b_observed+96(%rip)
 movq %r13,m3b_observed+104(%rip)
 movq %r14,m3b_observed+112(%rip)
 movq %r15,m3b_observed+120(%rip)
 pushfq
 popq m3b_observed+128(%rip)
 fxsave64 m3b_fp_after(%rip)
 movl m3x_mask(%rip),%eax
 xorl %edx,%edx
 xsave64 m3x_after(%rip)
 xrstor64 m3x_original(%rip)
 movq m3b_caller_rsp(%rip),%rsp
 popq %r15
 popq %r14
 popq %r13
 popq %r12
 popq %rbx
 popq %rbp
 ret
.size m3b_capture,.-m3b_capture

/* All program extents are compile-time symbols. Explicit branch bytes prevent
 * assembler branch relaxation from changing the declared128-byte boundary. */
.macro PROGRAM32 name,padding=0,moves=0,nearjmp=0,placement=0,dynamic=0,memory=0
 .balign 4096,0x90
 .if \placement
 .fill \placement,1,0x90
 .endif
 .globl \name,\name\()_b,\name\()_back,\name\()_side,\name\()_end
 .type \name,@function
\name:
 .rept \moves
 movabsq $0x7139ac4e0528b6df,%r8
 .endr
 .rept \padding
 nop
 .endr
 .if !\dynamic
 cmpl $0,%ecx
 .endif
 .byte 0x74
 .byte \name\()_side-(.+1)
\name\()_b:
 .if \memory
 addl $7,(%rsi)
 .else
 addl $53,%eax
 xorl %edx,%eax
 .endif
 subl $1,%ecx
\name\()_back:
 .if \nearjmp
 .byte 0xe9
 .long \name-(.+4)
 .else
 .byte 0xeb
 .byte \name-(.+1)
 .endif
\name\()_side:
 jmp m3b_capture
\name\()_end:
 .size \name,.-\name
.endm
PROGRAM32 m3b_add32
PROGRAM32 m3b_dynamic,0,0,0,0,1
PROGRAM32 m3b_memory,0,0,0,0,0,1
PROGRAM32 m3b_insns32,26
PROGRAM32 m3b_insns33,27
PROGRAM32 m3b_bytes128,0,11,1
PROGRAM32 m3b_bytes129,1,11,1
PROGRAM32 m3b_page_end,0,0,0,4081
PROGRAM32 m3b_page_cross,0,0,0,4089

.macro PROGRAM64 name,multiply=0
 .balign 4096,0x90
 .globl \name,\name\()_b,\name\()_back,\name\()_side,\name\()_end
 .type \name,@function
\name:
 cmpq $0,%r9
 .byte 0x74
 .byte \name\()_side-(.+1)
\name\()_b:
 .if \multiply
 imulq $-7,%r10,%r10
 .else
 xorq %r13,%r10
 .endif
 addq $17,%r10
 subq $1,%r9
\name\()_back:
 .byte 0xeb
 .byte \name-(.+1)
\name\()_side:
 jmp m3b_capture
\name\()_end:
 .size \name,.-\name
.endm
PROGRAM64 m3b_add64
PROGRAM64 m3b_imul64,1

.bss
.balign 8
m3b_caller_rsp: .quad 0
m3b_entry: .quad 0
.section .note.GNU-stack,"",@progbits
