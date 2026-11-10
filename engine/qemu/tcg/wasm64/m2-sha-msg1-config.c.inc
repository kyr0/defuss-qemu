/* SPDX-License-Identifier: GPL-2.0-or-later */
#include <emscripten.h>
/* ABI1 states: 0 default/off, 1 selected/off, 2 selected/on,
 * 3 translation-locked/off, 4 translation-locked/on. One atomic word prevents
 * a late selector from changing a choice already consumed by the translator.
 * Configure after noInitialRun module initialization and before callMain. */
static unsigned m2_msg1_state;
EMSCRIPTEN_KEEPALIVE int defuss_m2_msg1_config(unsigned enabled);
EMSCRIPTEN_KEEPALIVE int defuss_m2_msg1_config(unsigned enabled)
{
    if (enabled > 1) { return -1; }
    return qatomic_cmpxchg(&m2_msg1_state, 0, enabled ? 2 : 1) == 0 ? 0 : -1;
}
EMSCRIPTEN_KEEPALIVE unsigned defuss_m2_msg1_status(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m2_msg1_status(void)
{
    return 0x10000u | qatomic_read(&m2_msg1_state);
}
static bool m2_msg1_enabled(void)
{
    unsigned state = qatomic_read(&m2_msg1_state);
    while (state < 3) {
        unsigned locked = state == 2 ? 4 : 3;
        unsigned previous = qatomic_cmpxchg(&m2_msg1_state, state, locked);
        if (previous == state) { return locked == 4; }
        state = previous;
    }
    return state == 4;
}
