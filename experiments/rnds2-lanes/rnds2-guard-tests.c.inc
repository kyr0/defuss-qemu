#include <emscripten.h>
static void rnds2_guard_dummy(void) { }
static volatile unsigned rnds2_guard_marker;
static void rnds2_guard_other(void) { rnds2_guard_marker++; }
EMSCRIPTEN_KEEPALIVE int defuss_inline_rnds2_guard_selftest(void);
EMSCRIPTEN_KEEPALIVE int defuss_inline_rnds2_guard_selftest(void)
{
    TCGHelperInfo info = {
        .func = (void *)rnds2_guard_dummy, .name = "sha256rnds2",
        .typemask = dh_typecode_void | (dh_typecode_ptr << 3) |
            (dh_typecode_ptr << 6) | (dh_typecode_ptr << 9) |
            (dh_typecode_i32 << 12) | (dh_typecode_i32 << 15)
    };
    if (!inline_rnds2_matches((intptr_t)info.func, &info)) return 1;
    if (inline_rnds2_matches((intptr_t)rnds2_guard_other, &info)) return 2;
    info.flags = TCG_CALL_NO_RETURN;
    if (inline_rnds2_matches((intptr_t)info.func, &info)) return 3;
    info.flags = 0; info.name = NULL;
    if (inline_rnds2_matches((intptr_t)info.func, &info)) return 4;
    info.name = "sha256msg2";
    if (inline_rnds2_matches((intptr_t)info.func, &info)) return 5;
    info.name = "sha256rnds2";
    for (unsigned shift = 12; shift <= 15; shift += 3) {
        info.typemask ^= (dh_typecode_i32 ^ dh_typecode_s32) << shift;
        if (inline_rnds2_matches((intptr_t)info.func, &info)) return 6 + shift;
        info.typemask ^= (dh_typecode_i32 ^ dh_typecode_s32) << shift;
    }
    info.typemask |= dh_typecode_ptr << 18;
    if (inline_rnds2_matches((intptr_t)info.func, &info)) return 7;
    return 0;
}
