/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qemu/osdep.h"
#include "qemu/m3b-profile.h"
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include "qemu/atomic.h"
#include "exec/cpu-common.h"
#include "hw/core/boards.h"
#include "hw/core/cpu.h"
#include "hw/core/qdev.h"
#include "hw/i386/pc.h"
#include "system/block-backend-global-state.h"
#include "system/runstate.h"
#include "system/runstate-action.h"
#include "system/hostmem.h"
#include "system/numa.h"
#include "system/ramblock.h"
#include "system/address-spaces.h"
#include "qom/object.h"
#include "m3b-graph-contract.h"

#define M3B_GRAPH_MAX_DEVICES 128
#define M3B_GRAPH_MAX_TEXT (128 * 1024)
struct m3b_graph_row { char path[256], type[128], parent[256], bus[256]; };
static struct m3b_graph_row m3b_graph_rows[M3B_GRAPH_MAX_DEVICES];
static struct m3b_graph_row m3b_object_rows[32];
static char m3b_graph_text[M3B_GRAPH_MAX_TEXT];
static char m3b_object_text[32 * 512];
static unsigned m3b_graph_count, m3b_graph_length;
static unsigned m3b_object_count, m3b_object_length;
static uint32_t m3b_profile_config, m3b_profile_rejected, m3b_final_shutdown;
static unsigned m3b_memory_count;
static HostMemoryBackend *m3b_memory;
static MemoryRegion *m3b_ram;
static unsigned m3b_apic_count;
static DeviceState *m3b_apic;
static bool m3b_has_vapic;

EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_abi(void) { return 1; }
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_status(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_status(void)
{ return qatomic_load_acquire(&m3b_profile_config); }
unsigned defuss_m3b_profile_status(void) { return defuss_m3b_status(); }
unsigned defuss_m3b_profile_reasons(void)
{ return qatomic_read(&m3b_profile_rejected); }
bool defuss_m3b_profile_requested(void)
{ return defuss_m3b_status() & M3B_DIAGNOSTIC_PROFILE; }
bool defuss_m3b_profile_enabled(void)
{
    unsigned s = defuss_m3b_status();
    return (s & (M3B_ENABLED | M3B_CHOSEN | M3B_LOCKED |
                 M3B_DIAGNOSTIC_PROFILE | M3B_GRAPH_READY |
                 M3B_PROFILE_ELIGIBLE | M3B_PROFILE_FAULT)) ==
        (M3B_ENABLED | M3B_CHOSEN | M3B_LOCKED | M3B_DIAGNOSTIC_PROFILE |
         M3B_GRAPH_READY | M3B_PROFILE_ELIGIBLE);
}
EMSCRIPTEN_KEEPALIVE int defuss_m3b_configure(unsigned enabled, unsigned profile);
EMSCRIPTEN_KEEPALIVE int defuss_m3b_configure(unsigned enabled, unsigned profile)
{
    if (enabled > 1 || profile > 1 || (enabled && profile != 1)) { return -1; }
    if (enabled && !M3B_GRAPH_PINNED) { return -3; }
    unsigned chosen = M3B_CHOSEN | (enabled ? M3B_ENABLED : 0) |
        (profile ? M3B_DIAGNOSTIC_PROFILE : 0);
    return qatomic_cmpxchg(&m3b_profile_config, 0, chosen) == 0 ? 0 : -2;
}
void defuss_m3b_profile_fault(void)
{
    qatomic_or(&m3b_profile_rejected, M3B_REASON_RUNTIME);
    qatomic_or(&m3b_profile_config, M3B_PROFILE_FAULT);
}

bool defuss_m3b_mutation_allowed(Error **errp)
{
    unsigned s = defuss_m3b_status();
    if ((s & (M3B_DIAGNOSTIC_PROFILE | M3B_LOCKED)) !=
        (M3B_DIAGNOSTIC_PROFILE | M3B_LOCKED) ||
        qatomic_read(&m3b_final_shutdown)) { return true; }
    error_setg(errp, "M3b diagnostic profile forbids device/backend mutation");
    return false;
}
bool defuss_m3b_launch_allowed(bool unsafe, Error **errp)
{
    if (!defuss_m3b_profile_requested() || !unsafe) { return true; }
    error_setg(errp, "M3b diagnostic profile forbids autostart/user objects/HMP/GDB/qtest/incoming/loadvm/replay");
    return false;
}
bool defuss_m3b_qmp_allowed(const char *command, bool oob, Error **errp)
{
    static const char *const allowed[] = {
        "qmp_capabilities", "query-status", "query-version", "query-cpus-fast",
        "x-query-jit", "stop", "cont", "quit",
    };
    if (!defuss_m3b_profile_requested()) { return true; }
    if (!oob) {
        for (unsigned i = 0; i < ARRAY_SIZE(allowed); i++) {
            if (!strcmp(command, allowed[i])) { return true; }
        }
    }
    error_setg(errp, "Command forbidden by frozen M3b diagnostic control surface");
    return false;
}
void defuss_m3b_shutdown(void)
{
    /* Called only after vm_shutdown: no later vCPU/device emulation. Ordinary
     * pause/resume never unlocks the profile or device lifecycle fences. */
    qatomic_set(&m3b_final_shutdown, 1);
}

static bool m3b_copy_graph_string(char *out, size_t capacity, const char *in)
{
    if (!in) { in = ""; }
    size_t length = strlen(in);
    if (length >= capacity || strpbrk(in, "\t\r\n")) { return false; }
    memcpy(out, in, length + 1);
    return true;
}
static int m3b_collect_device(Object *obj, void *opaque)
{
    if (obj->parent == object_get_objects_root()) {
        if (m3b_object_count == ARRAY_SIZE(m3b_object_rows)) { return -1; }
        struct m3b_graph_row *row = &m3b_object_rows[m3b_object_count];
        g_autofree char *path = object_get_canonical_path(obj);
        if (!path || !m3b_copy_graph_string(row->path, sizeof(row->path), path) ||
            !m3b_copy_graph_string(row->type, sizeof(row->type), object_get_typename(obj))) {
            return -1;
        }
        m3b_object_count++;
    }
    HostMemoryBackend *backend = (HostMemoryBackend *)object_dynamic_cast(obj, TYPE_MEMORY_BACKEND);
    if (backend) { m3b_memory_count++; m3b_memory = backend; }
    DeviceState *dev = (DeviceState *)object_dynamic_cast(obj, TYPE_DEVICE);
    if (!dev) { return 0; }
    if (!qatomic_load_acquire(&dev->realized)) { return -1; }
    if (object_dynamic_cast(obj, "apic-common")) {
        m3b_apic_count++;
        m3b_apic = dev;
    }
    if (!strcmp(object_get_typename(obj), "kvmvapic")) { m3b_has_vapic = true; }
    if (m3b_graph_count == M3B_GRAPH_MAX_DEVICES) { return -1; }
    struct m3b_graph_row *row = &m3b_graph_rows[m3b_graph_count];
    g_autofree char *path = object_get_canonical_path(obj);
    g_autofree char *parent = obj->parent ? object_get_canonical_path(obj->parent) : NULL;
    g_autofree char *bus = dev->parent_bus ?
        object_get_canonical_path(OBJECT(dev->parent_bus)) : NULL;
    if (!path || !m3b_copy_graph_string(row->path, sizeof(row->path), path) ||
        !m3b_copy_graph_string(row->type, sizeof(row->type), object_get_typename(obj)) ||
        !m3b_copy_graph_string(row->parent, sizeof(row->parent), parent) ||
        !m3b_copy_graph_string(row->bus, sizeof(row->bus), bus)) { return -1; }
    m3b_graph_count++;
    return 0;
}
static int m3b_graph_compare(const void *left, const void *right)
{
    const struct m3b_graph_row *a = left, *b = right;
    return strcmp(a->path, b->path);
}
void defuss_m3b_machine_freeze(MachineState *machine)
{
    unsigned old = qatomic_fetch_or(&m3b_profile_config, M3B_LOCKED);
    if (old & M3B_LOCKED) {
        /* Published graph bytes remain immutable, including on invalid repeat. */
        defuss_m3b_profile_fault();
        return;
    }
    if (!(old & M3B_DIAGNOSTIC_PROFILE)) { return; }
    unsigned reasons = 0, cpus = 0;
    CPUState *cpu;
    CPU_FOREACH(cpu) { cpus++; }
    if (!object_dynamic_cast(OBJECT(machine), TYPE_PC_MACHINE) ||
        machine->smp.cpus != 1 || machine->smp.max_cpus != 1 || cpus != 1 ||
        machine->ram_size != UINT64_C(512) * 1024 * 1024 ||
        machine->maxram_size != machine->ram_size || machine->ram_slots != 0 ||
        runstate_is_running() || reboot_action != REBOOT_ACTION_SHUTDOWN ||
        !first_cpu || first_cpu->cpu_index != 0 || first_cpu->unplug ||
        first_cpu->parent_obj.hotplugged || !machine->possible_cpus ||
        machine->possible_cpus->len != 1 ||
        machine->possible_cpus->cpus[0].cpu != first_cpu) {
        reasons |= M3B_REASON_TOPOLOGY;
    } else if (PC_MACHINE(machine)->hpet_enabled || machine_usb(machine) ||
               X86_MACHINE(machine)->acpi_dev != NULL ||
               x86_machine_is_acpi_enabled(X86_MACHINE(machine)) ||
               X86_MACHINE(machine)->ioapic_as != &address_space_memory) {
        reasons |= M3B_REASON_PROFILE;
    }
    /* Includes hidden/unattached backends, unlike QMP query-block. Later
     * creation, insertion and attachment are all fenced before mutation. */
    if (blk_all_next(NULL)) { reasons |= M3B_REASON_BACKENDS; }
    if (object_child_foreach_recursive(object_get_root(), m3b_collect_device, NULL)) {
        reasons |= M3B_REASON_OVERFLOW;
    }
    /* A vAPIC page would permit APIC interrupt delivery to write guest RAM.
     * The exact graph is insufficient: verify effective native APIC facts. */
    if (m3b_has_vapic || m3b_apic_count != 1 || !first_cpu ||
        !defuss_m3b_apic_safe(first_cpu, m3b_apic)) {
        reasons |= M3B_REASON_PROFILE;
    }
    if (m3b_memory_count != 1 || !m3b_memory || m3b_memory != machine->memdev ||
        strcmp(object_get_typename(OBJECT(m3b_memory)), TYPE_MEMORY_BACKEND_RAM) ||
        m3b_memory->size != machine->ram_size || m3b_memory->share ||
        m3b_memory->guest_memfd || m3b_memory->prealloc ||
        m3b_memory->prealloc_context ||
        (machine->numa_state && machine->numa_state->num_nodes)) {
        reasons |= M3B_REASON_BACKENDS;
    } else {
        g_autofree char *path = object_get_canonical_path(OBJECT(m3b_memory));
        m3b_ram = host_memory_backend_get_memory(m3b_memory);
        if (!path || (M3B_GRAPH_PINNED && strcmp(path, m3b_expected_memory_path)) ||
            !m3b_ram || m3b_ram != machine->ram || !memory_region_is_ram(m3b_ram) ||
            memory_region_is_ram_device(m3b_ram) || memory_region_is_romd(m3b_ram) ||
            m3b_ram->readonly || m3b_ram->rom_device) {
            reasons |= M3B_REASON_BACKENDS;
        }
    }
    qsort(m3b_graph_rows, m3b_graph_count, sizeof(m3b_graph_rows[0]), m3b_graph_compare);
    qsort(m3b_object_rows, m3b_object_count, sizeof(m3b_object_rows[0]), m3b_graph_compare);
    for (unsigned i = 0; i < m3b_object_count; i++) {
        struct m3b_graph_row *r = &m3b_object_rows[i];
        int n = snprintf(m3b_object_text + m3b_object_length,
                         sizeof(m3b_object_text) - m3b_object_length,
                         "%s\t%s\n", r->path, r->type);
        if (n < 0 || (size_t)n >= sizeof(m3b_object_text) - m3b_object_length ||
            (i && !strcmp(r->path, m3b_object_rows[i - 1].path))) {
            reasons |= M3B_REASON_OVERFLOW;
            break;
        }
        m3b_object_length += n;
    }
    for (unsigned i = 0; i < m3b_graph_count; i++) {
        struct m3b_graph_row *r = &m3b_graph_rows[i];
        if (i && !strcmp(r->path, m3b_graph_rows[i - 1].path)) {
            reasons |= M3B_REASON_GRAPH;
        }
        int n = snprintf(m3b_graph_text + m3b_graph_length,
                         sizeof(m3b_graph_text) - m3b_graph_length,
                         "%s\t%s\t%s\t%s\n", r->path, r->type, r->parent, r->bus);
        if (n < 0 || (size_t)n >= sizeof(m3b_graph_text) - m3b_graph_length) {
            reasons |= M3B_REASON_OVERFLOW;
            break;
        }
        m3b_graph_length += n;
    }
    if (!M3B_GRAPH_PINNED) { reasons |= M3B_REASON_UNPINNED; }
    else if (!m3b_graph_count ||
             strcmp(object_get_typename(OBJECT(machine)), m3b_expected_machine) ||
             strcmp(m3b_graph_text, m3b_expected_graph) ||
             strcmp(m3b_object_text, m3b_expected_objects)) { reasons |= M3B_REASON_GRAPH; }
    qatomic_or(&m3b_profile_rejected, reasons);
    qatomic_fetch_or(&m3b_profile_config, M3B_GRAPH_READY |
                    (reasons ? 0 : M3B_PROFILE_ELIGIBLE));
}

/* get_page_addr_code_hostp has already checked the actual instruction-fetch
 * mapping and returns this RAM address. Refuse ROM/device/foreign/shared RAM
 * before predecoding any byte. No second guest-page lookup is performed. */
bool defuss_m3b_ram_span(void *host, size_t size, uint64_t ram_address)
{
    ram_addr_t offset;
    if (!defuss_m3b_profile_enabled() || !host || !size || size > 128 || !m3b_ram) {
        return false;
    }
    RCU_READ_LOCK_GUARD();
    RAMBlock *block = qemu_ram_block_from_host(host, false, &offset);
    return block && block->mr == m3b_ram && block == m3b_ram->ram_block &&
        block->used_length == UINT64_C(512) * 1024 * 1024 &&
        block->max_length == block->used_length &&
        !(block->flags & (RAM_SHARED | RAM_RESIZEABLE | RAM_GUEST_MEMFD)) &&
        block->fd < 0 && block->guest_memfd < 0 &&
        offset >= 1024 * 1024 && offset < block->used_length &&
        size <= block->used_length - offset && block->offset + offset == ram_address;
}
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_graph_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_graph_data(void)
{
    return defuss_m3b_status() & M3B_GRAPH_READY ? (uintptr_t)m3b_graph_text : 0;
}
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_graph_size(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_graph_size(void)
{ return defuss_m3b_status() & M3B_GRAPH_READY ? m3b_graph_length : 0; }
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_objects_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_objects_data(void)
{ return defuss_m3b_status() & M3B_GRAPH_READY ? (uintptr_t)m3b_object_text : 0; }
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_objects_size(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3b_objects_size(void)
{ return defuss_m3b_status() & M3B_GRAPH_READY ? m3b_object_length : 0; }
#endif
