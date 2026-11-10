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
