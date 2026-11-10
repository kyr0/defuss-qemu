roms = []
if unpack_edk2_blobs
  fds = [
    'edk2-aarch64-code.fd',
    'edk2-arm-code.fd',
    'edk2-arm-vars.fd',
    'edk2-i386-code.fd',
    'edk2-i386-secure-code.fd',
    'edk2-i386-vars.fd',
    'edk2-x86_64-code.fd',
    'edk2-x86_64-secure-code.fd',
  ]

  foreach f : fds
    roms += custom_target(f,
                  build_by_default: have_system,
                  output: f,
                  input: files('@0@.bz2'.format(f)),
                  capture: true,
                  install: get_option('install_blobs'),
                  install_dir: qemu_datadir,
                  command: [ bzip2, '-dc', '@INPUT0@' ])
  endforeach
endif

blobs = [
  'ast27x0_bootrom.bin',
  'bios.bin',
  'bios-256k.bin',
  'bios-microvm.bin',
  'qboot.rom',
  'vgabios.bin',
  'vgabios-cirrus.bin',
  'vgabios-stdvga.bin',
  'vgabios-vmware.bin',
  'vgabios-qxl.bin',
  'vgabios-virtio.bin',
  'vgabios-ramfb.bin',
  'vgabios-bochs-display.bin',
  'vgabios-ati.bin',
  'pxe-e1000.rom',
  'pxe-eepro100.rom',
  'pxe-ne2k_pci.rom',
  'pxe-pcnet.rom',
  'pxe-rtl8139.rom',
  'pxe-virtio.rom',
  'efi-e1000.rom',
  'efi-eepro100.rom',
  'efi-ne2k_pci.rom',
  'efi-pcnet.rom',
  'efi-rtl8139.rom',
  'efi-virtio.rom',
  'efi-e1000e.rom',
  'efi-vmxnet3.rom',
  'multiboot_dma.bin',
  'linuxboot_dma.bin',
  'kvmvapic.bin',
  'pvh.bin',
  'edk2-licenses.txt',
  'npcm7xx_bootrom.bin',
  'npcm8xx_bootrom.bin',
]

if get_option('install_blobs')
  install_data(blobs, install_dir: qemu_datadir, install_mode: 'rw-r--r--')
endif

subdir('descriptors')
subdir('keymaps')
