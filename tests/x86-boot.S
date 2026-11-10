/* Boot-sector smoke: real mode, protected mode, integer state, and output.
 * Assemble with GNU as --32, link at 0x7c00 as a flat binary.
 */
.code16
.global _start
_start:
    cli
    ljmp $0, $entry
entry:
    xor %ax, %ax
    mov %ax, %ds
    mov %ax, %es
    mov %ax, %ss
    mov $0x7c00, %sp
    mov $real_message, %si
real_print:
    lodsb
    test %al, %al
    jz enter_protected
    outb %al, $0xe9
    jmp real_print
enter_protected:
    lgdt gdt_pointer
    mov %cr0, %eax
    or $1, %eax
    mov %eax, %cr0
    ljmp $8, $protected
.code32
protected:
    mov $16, %ax
    mov %ax, %ds
    mov %ax, %es
    mov %ax, %ss
    mov $0x7000, %esp
    mov $7, %eax
    imul $13, %eax, %eax
    add $9, %eax
    cmp $100, %eax
    jne failed
    mov $protected_message, %esi
    jmp protected_print
failed:
    mov $failed_message, %esi
protected_print:
    lodsb
    test %al, %al
    jz done
    outb %al, $0xe9
    jmp protected_print
done:
    hlt
    jmp done
.balign 8
gdt:
    .quad 0
    .quad 0x00cf9a000000ffff
    .quad 0x00cf92000000ffff
gdt_end:
gdt_pointer:
    .word gdt_end - gdt - 1
    .long gdt
real_message: .asciz "DEFUSS_X86_16_OK\n"
protected_message: .asciz "DEFUSS_X86_32_OK\n"
failed_message: .asciz "DEFUSS_X86_FAIL\n"
.org 510
.word 0xaa55
