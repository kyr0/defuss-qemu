.text
.globl pressure_sentinel,pressure_sentinel_loop,pressure_sentinel_end
.type pressure_sentinel,@function
pressure_sentinel:
    mov %edi,%ecx
    xor %eax,%eax
pressure_sentinel_loop:
    add %esi,%eax
    dec %ecx
    jnz pressure_sentinel_loop
    ret
pressure_sentinel_end:
.size pressure_sentinel,.-pressure_sentinel
.section .note.GNU-stack,"",@progbits
