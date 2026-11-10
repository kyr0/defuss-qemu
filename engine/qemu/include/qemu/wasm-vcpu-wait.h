/* Emscripten MTTCG diagnostics. cpu_index is 0..254 on the supported PC. */
#ifndef QEMU_WASM_VCPU_WAIT_H
#define QEMU_WASM_VCPU_WAIT_H
#include "qemu/typedefs.h"
extern bool wasm47_pause;
extern bool wasm47_meter;
extern bool wasm47_irq;
void wasm47_irq_wake(CPUState *cpu);
void wasm47_interrupt_boundary(CPUState *cpu);
uint64_t wasm47_now(void);
void wasm47_exec_start(CPUState *cpu, uint64_t now);
void wasm47_exec_done(CPUState *cpu, uint64_t start, uint64_t end, uint64_t locked);
#endif
