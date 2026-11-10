/* SPDX-License-Identifier: GPL-2.0-or-later */
/* The Wasm TCI frame uses 8-byte slots. Named helpers can bypass libffi
 * through a typed C wrapper; indirect/non-returning calls keep the old ABI. */
#ifndef QEMU_HELPER_WASM_THUNK_MACROS
#define QEMU_HELPER_WASM_THUNK_MACROS
#if defined(__EMSCRIPTEN__) && !defined(CONFIG_TCG_INTERPRETER)
#define WTH_ARG(T, I) \
    dh_ctype(T) a##I; \
    memcpy(&a##I, slots + slot, sizeof(a##I)); \
    slot += DIV_ROUND_UP(sizeof(a##I), sizeof(*slots));
#define WTH_RET_VALUE(T, CALL) do { \
    dh_ctype(T) result = (CALL); \
    memcpy(slots, &result, sizeof(result)); \
} while (0)
#define WTH_RET_i32 WTH_RET_VALUE
#define WTH_RET_i64 WTH_RET_VALUE
#define WTH_RET_i128 WTH_RET_VALUE
#define WTH_RET_ptr WTH_RET_VALUE
#define WTH_RET_void(T, CALL) (CALL)
#define WTH_RET_noreturn(T, CALL) (CALL)
#define WTH_RETURN(T, CALL) glue(WTH_RET_, dh_alias(T))(T, CALL)
#define WTH_DECL_0()
#define WTH_PASS_0
#define WTH_DECL_1(T1) WTH_DECL_0() WTH_ARG(T1, 1)
#define WTH_PASS_1 a1
#define WTH_DECL_2(T1, T2) WTH_DECL_1(T1) WTH_ARG(T2, 2)
#define WTH_PASS_2 a1, a2
#define WTH_DECL_3(T1, T2, T3) WTH_DECL_2(T1, T2) WTH_ARG(T3, 3)
#define WTH_PASS_3 a1, a2, a3
#define WTH_DECL_4(T1, T2, T3, T4) WTH_DECL_3(T1, T2, T3) WTH_ARG(T4, 4)
#define WTH_PASS_4 a1, a2, a3, a4
#define WTH_DECL_5(T1, T2, T3, T4, T5) WTH_DECL_4(T1, T2, T3, T4) WTH_ARG(T5, 5)
#define WTH_PASS_5 a1, a2, a3, a4, a5
#define WTH_DECL_6(T1, T2, T3, T4, T5, T6) WTH_DECL_5(T1, T2, T3, T4, T5) WTH_ARG(T6, 6)
#define WTH_PASS_6 a1, a2, a3, a4, a5, a6
#define WTH_DECL_7(T1, T2, T3, T4, T5, T6, T7) WTH_DECL_6(T1, T2, T3, T4, T5, T6) WTH_ARG(T7, 7)
#define WTH_PASS_7 a1, a2, a3, a4, a5, a6, a7
#define WASM_TYPED_THUNK(N, NAME, RET, ...) \
    static void glue(wasm_thunk_, NAME)(uint64_t *slots) \
    { \
        unsigned G_GNUC_UNUSED slot = 0; \
        glue(WTH_DECL_, N)(__VA_ARGS__) \
        WTH_RETURN(RET, HELPER(NAME)(glue(WTH_PASS_, N))); \
    }
#define WASM_TYPED_FIELD(NAME) .wasm_thunk = glue(wasm_thunk_, NAME),
#else
#define WASM_TYPED_THUNK(N, NAME, RET, ...)
#define WASM_TYPED_FIELD(NAME)
#endif
#endif
