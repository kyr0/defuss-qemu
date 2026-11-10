/* Exact graph observed under explicit -global apic.vapic=off in observation03.
 * Prospective native contract only; native backend/lifecycle/profile gates still apply. */
#define M3B_GRAPH_PINNED 1
static const char m3b_expected_machine[] =
    "pc-i440fx-11.1-machine"
;
static const char m3b_expected_memory_path[] =
    "/objects/pc.ram"
;
static const char m3b_expected_graph[] =
    "/machine/fw_cfg\tfw_cfg_io\t/machine\t/machine/unattached/sysbus\n"
    "/machine/i440fx\ti440FX-pcihost\t/machine\t/machine/unattached/sysbus\n"
    "/machine/i440fx/ioapic\tioapic\t/machine/i440fx\t/machine/unattached/sysbus\n"
    "/machine/unattached/device[0]\tmax-x86_64-cpu\t/machine/unattached\t\n"
    "/machine/unattached/device[0]/lapic\tapic\t/machine/unattached/device[0]\t\n"
    "/machine/unattached/device[10]\ti8042\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[10]/ps2kbd\tps2-kbd\t/machine/unattached/device[10]\t/machine/unattached/sysbus\n"
    "/machine/unattached/device[10]/ps2mouse\tps2-mouse\t/machine/unattached/device[10]\t/machine/unattached/sysbus\n"
    "/machine/unattached/device[11]\tvmport\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[12]\tvmmouse\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[13]\tport92\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[1]\ti440FX\t/machine/unattached\t/machine/i440fx/pci.0\n"
    "/machine/unattached/device[2]\tPIIX3\t/machine/unattached\t/machine/i440fx/pci.0\n"
    "/machine/unattached/device[2]/dma[0]\ti8257\t/machine/unattached/device[2]\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[2]/dma[1]\ti8257\t/machine/unattached/device[2]\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[2]/ide\tpiix3-ide\t/machine/unattached/device[2]\t/machine/i440fx/pci.0\n"
    "/machine/unattached/device[2]/rtc\tmc146818rtc\t/machine/unattached/device[2]\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[3]\tisa-i8259\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[4]\tisa-i8259\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[5]\tisa-pit\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[6]\tisa-pcspk\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[7]\tisa-serial\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[7]/serial\tserial\t/machine/unattached/device[7]\t\n"
    "/machine/unattached/device[8]\tisa-serial\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
    "/machine/unattached/device[8]/serial\tserial\t/machine/unattached/device[8]\t\n"
    "/machine/unattached/device[9]\tisa-fdc\t/machine/unattached\t/machine/unattached/device[2]/isa.0\n"
;
static const char m3b_expected_objects[] =
    "/objects/compat_monitor0\tmonitor-qmp\n"
    "/objects/pc.ram\tmemory-backend-ram\n"
;
