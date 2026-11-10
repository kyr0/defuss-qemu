/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef DEFUSS_M3B_PROFILE_H
#define DEFUSS_M3B_PROFILE_H
#include "qapi/error.h"
typedef struct MachineState MachineState;
typedef struct CPUState CPUState;
typedef struct DeviceState DeviceState;

enum {
    M3B_ENABLED = 1, M3B_CHOSEN = 2, M3B_LOCKED = 4,
    M3B_DIAGNOSTIC_PROFILE = 8, M3B_GRAPH_READY = 16,
    M3B_PROFILE_ELIGIBLE = 32, M3B_PROFILE_FAULT = 64,
};
enum {
    M3B_REASON_UNPINNED = 1, M3B_REASON_GRAPH = 2,
    M3B_REASON_TOPOLOGY = 4, M3B_REASON_BACKENDS = 8,
    M3B_REASON_PROFILE = 16, M3B_REASON_RUNTIME = 32,
    M3B_REASON_OVERFLOW = 64,
};
#ifdef __EMSCRIPTEN__
unsigned defuss_m3b_profile_status(void);
unsigned defuss_m3b_profile_reasons(void);
bool defuss_m3b_profile_requested(void);
bool defuss_m3b_profile_enabled(void);
bool defuss_m3b_ram_span(void *host, size_t size, uint64_t ram_address);
bool defuss_m3b_apic_safe(CPUState *cpu, DeviceState *device);
void defuss_m3b_profile_fault(void);
bool defuss_m3b_mutation_allowed(Error **errp);
bool defuss_m3b_qmp_allowed(const char *command, bool oob, Error **errp);
bool defuss_m3b_launch_allowed(bool unsafe, Error **errp);
void defuss_m3b_machine_freeze(MachineState *machine);
void defuss_m3b_shutdown(void);
#else
static inline bool defuss_m3b_profile_requested(void) { return false; }
static inline bool defuss_m3b_mutation_allowed(Error **errp) { return true; }
static inline bool defuss_m3b_qmp_allowed(const char *c, bool o, Error **e)
{ return true; }
static inline bool defuss_m3b_launch_allowed(bool u, Error **e) { return true; }
static inline void defuss_m3b_machine_freeze(MachineState *m) {}
static inline void defuss_m3b_shutdown(void) {}
#endif
#endif
