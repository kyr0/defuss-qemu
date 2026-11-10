/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef DEFUSS_M3B_PREDECODE_H
#define DEFUSS_M3B_PREDECODE_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define M3B_MAX_INSNS 32u
#define M3B_MAX_BYTES 128u
#define M3B_BACKEDGE_BUDGET 1u

enum m3b_kind {
    M3B_NONE, M3B_ADD, M3B_OR, M3B_AND, M3B_SUB, M3B_XOR, M3B_CMP,
    M3B_TEST, M3B_MOV, M3B_IMUL, M3B_SHL, M3B_SHR, M3B_SAR,
    M3B_INC, M3B_DEC, M3B_NOT, M3B_NEG, M3B_NOP, M3B_JCC, M3B_JMP,
};
enum m3b_predecode_result {
    M3B_SHAPE_OK, M3B_SHAPE_LIMIT, M3B_SHAPE_TRUNCATED,
    M3B_SHAPE_OPCODE, M3B_SHAPE_PREFIX, M3B_SHAPE_MEMORY,
    M3B_SHAPE_CONTROL, M3B_SHAPE_CLOSURE,
};
struct m3b_insn {
    uint8_t offset, length, kind, rex;
};
struct m3b_plan {
    uint16_t bytes, count, b_offset, jcc_index;
    uint16_t jcc_target_offset, backedge_offset;
    struct m3b_insn insns[M3B_MAX_INSNS];
};
struct m3b_cursor {
    const uint8_t *bytes;
    size_t next, limit;
};

static inline bool m3b_take(struct m3b_cursor *c, unsigned n, uint32_t *value)
{
    if (n > 4 || c->next > c->limit || n > c->limit - c->next) {
        return false;
    }
    uint32_t v = 0;
    for (unsigned i = 0; i < n; i++) {
        v |= (uint32_t)c->bytes[c->next + i] << (i * 8);
    }
    c->next += n;
    if (value) {
        *value = v;
    }
    return true;
}

static inline int64_t m3b_signed(uint32_t value, unsigned bytes)
{
    uint64_t sign = UINT64_C(1) << (bytes * 8 - 1);
    return value & sign ? (int64_t)value - (int64_t)(sign * 2) : value;
}

/* Integer comparisons avoid constructing out-of-object pointers or wrapping an
 * end address. The supplied objects must otherwise be valid for their stated
 * bounded sizes. This is a caller-contract check, not a mapping probe. */
static inline bool m3b_overlaps(const void *a, size_t a_size,
                                const void *b, size_t b_size)
{
    uintptr_t x = (uintptr_t)a, y = (uintptr_t)b;
    if (!a_size || !b_size) { return false; }
    return x <= y ? y - x < a_size : x - y < b_size;
}

/* Deliberately narrow byte-level admission. It does not execute or replace the
 * x86 decoder. The integration must additionally match QEMU's decoded emitter,
 * instruction lengths, register-only operands and completed TCG effects.
 * The caller supplies only the already mapped first-page span; no callback or
 * speculative second-page access is possible in this predecoder. Decode in
 * a local object and publish only a fully closed shape. Ordinary rejection
 * clears the output; NULL output and overlapping input/output are rejected
 * without writes. Input and output must otherwise point to valid objects.
 * The caller must separately establish x86-64/default32 operand decoding,
 * executable ordinary RAM, current bytes and the eligible execution mode. */
static inline enum m3b_predecode_result m3b_predecode(
    const uint8_t *bytes, size_t available, unsigned page_remaining,
    unsigned max_insns, struct m3b_plan *plan)
{
    struct m3b_cursor c = {bytes, 0, available};
    struct m3b_plan decoded = {0};
    struct m3b_plan *output = plan;
    int64_t side_target = -1;
    if (!output) { return M3B_SHAPE_LIMIT; }
    if (c.limit > page_remaining) { c.limit = page_remaining; }
    if (c.limit > M3B_MAX_BYTES) { c.limit = M3B_MAX_BYTES; }
    if (bytes && m3b_overlaps(bytes, c.limit, output, sizeof(*output))) {
        return M3B_SHAPE_LIMIT;
    }
    memset(output, 0, sizeof(*output));
    if (!bytes || !max_insns || !c.limit) { return M3B_SHAPE_LIMIT; }
    if (max_insns > M3B_MAX_INSNS) { max_insns = M3B_MAX_INSNS; }
    plan = &decoded;
    while (plan->count < max_insns && c.next < c.limit) {
        size_t start = c.next;
        uint32_t op, modrm = 0, immediate = 0;
        unsigned imm_bytes = 0, modrm_group = 0;
        uint8_t rex = 0;
        enum m3b_kind kind = M3B_NONE;
        bool has_modrm = false, group = false, branch = false;
        if (!m3b_take(&c, 1, &op)) { return M3B_SHAPE_TRUNCATED; }
        if (op >= 0x40 && op <= 0x4f) {
            rex = op;
            if (!m3b_take(&c, 1, &op)) { return M3B_SHAPE_TRUNCATED; }
        }
        if ((op >= 0x40 && op <= 0x4f) || op == 0x66 || op == 0x67 ||
            op == 0xf0 || op == 0xf2 || op == 0xf3 || op == 0x26 ||
            op == 0x2e || op == 0x36 || op == 0x3e || op == 0x64 || op == 0x65) {
            return M3B_SHAPE_PREFIX;
        }
        if (op >= 0x70 && op <= 0x7f) {
            kind = M3B_JCC; imm_bytes = 1; branch = true;
        } else if (op >= 0xb8 && op <= 0xbf) {
            kind = M3B_MOV;
            /* movabs has eight bytes; consume the low half here and the high
             * half through the same checked cursor below. */
            if ((rex & 8) && !m3b_take(&c, 4, NULL)) {
                return M3B_SHAPE_TRUNCATED;
            }
            imm_bytes = 4;
        } else {
            switch (op) {
            case 0x01: case 0x03: kind = M3B_ADD; has_modrm = true; break;
            case 0x09: case 0x0b: kind = M3B_OR; has_modrm = true; break;
            case 0x21: case 0x23: kind = M3B_AND; has_modrm = true; break;
            case 0x29: case 0x2b: kind = M3B_SUB; has_modrm = true; break;
            case 0x31: case 0x33: kind = M3B_XOR; has_modrm = true; break;
            case 0x39: case 0x3b: kind = M3B_CMP; has_modrm = true; break;
            case 0x85: kind = M3B_TEST; has_modrm = true; break;
            case 0x89: case 0x8b: kind = M3B_MOV; has_modrm = true; break;
            case 0x05: kind = M3B_ADD; imm_bytes = 4; break;
            case 0x0d: kind = M3B_OR; imm_bytes = 4; break;
            case 0x25: kind = M3B_AND; imm_bytes = 4; break;
            case 0x2d: kind = M3B_SUB; imm_bytes = 4; break;
            case 0x35: kind = M3B_XOR; imm_bytes = 4; break;
            case 0x3d: kind = M3B_CMP; imm_bytes = 4; break;
            case 0xa9: kind = M3B_TEST; imm_bytes = 4; break;
            case 0x69: case 0x6b:
                kind = M3B_IMUL; has_modrm = true;
                imm_bytes = op == 0x69 ? 4 : 1; break;
            case 0x81: case 0x83: case 0xc1: case 0xd1: case 0xff:
            case 0xf7: case 0xc7:
                has_modrm = group = true; modrm_group = op; break;
            case 0x90:
                if (rex) { return M3B_SHAPE_PREFIX; }
                kind = M3B_NOP; break;
            case 0xeb: case 0xe9:
                kind = M3B_JMP; imm_bytes = op == 0xeb ? 1 : 4;
                branch = true; break;
            case 0x0f:
                if (!m3b_take(&c, 1, &op)) { return M3B_SHAPE_TRUNCATED; }
                if (op >= 0x80 && op <= 0x8f) {
                    kind = M3B_JCC; imm_bytes = 4; branch = true;
                } else if (op == 0xaf) {
                    kind = M3B_IMUL; has_modrm = true;
                } else { return M3B_SHAPE_OPCODE; }
                break;
            default: return M3B_SHAPE_OPCODE;
            }
        }
        if (branch && rex) { return M3B_SHAPE_PREFIX; }
        if (has_modrm) {
            if (!m3b_take(&c, 1, &modrm)) { return M3B_SHAPE_TRUNCATED; }
            if ((modrm >> 6) != 3) { return M3B_SHAPE_MEMORY; }
        }
        if (group) {
            unsigned sub = (modrm >> 3) & 7;
            if (modrm_group == 0x81 || modrm_group == 0x83) {
                static const uint8_t kinds[8] = {M3B_ADD, M3B_OR, M3B_NONE,
                    M3B_NONE, M3B_AND, M3B_SUB, M3B_XOR, M3B_CMP};
                kind = kinds[sub]; imm_bytes = modrm_group == 0x81 ? 4 : 1;
            } else if (modrm_group == 0xc1 || modrm_group == 0xd1) {
                kind = sub == 4 ? M3B_SHL : sub == 5 ? M3B_SHR :
                       sub == 7 ? M3B_SAR : M3B_NONE;
                imm_bytes = modrm_group == 0xc1 ? 1 : 0;
            } else if (modrm_group == 0xff) {
                kind = sub == 0 ? M3B_INC : sub == 1 ? M3B_DEC : M3B_NONE;
            } else if (modrm_group == 0xf7) {
                kind = sub == 0 ? M3B_TEST : sub == 2 ? M3B_NOT :
                       sub == 3 ? M3B_NEG : M3B_NONE;
                imm_bytes = sub == 0 ? 4 : 0;
            } else {
                kind = sub == 0 ? M3B_MOV : M3B_NONE; imm_bytes = 4;
            }
            if (kind == M3B_NONE) { return M3B_SHAPE_OPCODE; }
        }
        if (!m3b_take(&c, imm_bytes, &immediate)) {
            return M3B_SHAPE_TRUNCATED;
        }
        if (c.next - start > 15) { return M3B_SHAPE_LIMIT; }
        struct m3b_insn *insn = &plan->insns[plan->count++];
        *insn = (struct m3b_insn){start, c.next - start, kind, rex};
        if (kind == M3B_JCC) {
            if (side_target != -1) { return M3B_SHAPE_CONTROL; }
            side_target = (int64_t)c.next + m3b_signed(immediate, imm_bytes);
            if (side_target <= (int64_t)c.next || side_target > (int64_t)c.limit) {
                return M3B_SHAPE_CLOSURE;
            }
            plan->b_offset = c.next; plan->jcc_index = plan->count - 1;
            plan->jcc_target_offset = (uint16_t)side_target;
        } else if (kind == M3B_JMP) {
            if (side_target < 0 || (int64_t)c.next != side_target ||
                (int64_t)c.next + m3b_signed(immediate, imm_bytes) != 0) {
                return M3B_SHAPE_CLOSURE;
            }
            plan->bytes = c.next;
            plan->backedge_offset = start;
            *output = decoded;
            return M3B_SHAPE_OK;
        }
        if (side_target != -1 && c.next >= (size_t)side_target) {
            return M3B_SHAPE_CLOSURE;
        }
    }
    return M3B_SHAPE_LIMIT;
}
#endif
