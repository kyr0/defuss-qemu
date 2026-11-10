// Cold diagnostic exposure only; the guest bundle/filesystem remain original M1.
export const protocol='defuss-m3b-bun-cold-admission-v1';
export const bindingPath='artifacts/m3b-admission-binding-01/binding.json';
export const bindingSha256='d0020fa7f08233f86048a7365ebc52f88123198ac2f3de7d3698fe075a625465';
export const packagePath='artifacts/m2-msg1-exposure-off-package-01';
export const guestGeneration='efae27ba1965a4769c86b3edbf77991a87c521a22fcb69510e45242c6597f954';
export const unchangedGuest=Object.freeze({appSha256:'31d28add91e5a78aee775e57a365828f2b75843fc9bbd26b66bfe06e9d4717d5',initramfsSha256:'d54f7ed772e0249f6e6d52c7d795a9cd566a378555dbc7f7961aed830b3bd2c6'});
export const args=Object.freeze(['-nodefaults','-machine','pc,acpi=off,hpet=off,usb=off','-cpu','max','-global','apic.vapic=off','-accel','tcg,tb-size=128','-smp','cpus=1,maxcpus=1','-m','512','-S',
 '-display','none','-monitor','none','-qmp','stdio','-chardev','file,id=fixture-com1,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:fixture-com1','-serial','file:/guest/console.log',
 '-parallel','none','-no-reboot','-no-shutdown','-L','/rom','-kernel','/guest/kernel','-initrd','/guest/initramfs','-append','console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on']);
export const limits=Object.freeze({serial:4*1024*1024,stderr:1024*1024,record:5*1024*1024,records:72,timeout:1800000});
export const scope='Global unchanged-Bun phase counts plus translation-admission stages, overlapping rejection reasons and one bounded last decoder-input sample. Includes kernel/serial/gate work; no application-PC attribution, retired-body, exclusive-time, snapshot, resource-improvement or speedup claim. Original guards and default-off guarded profile retained.';
