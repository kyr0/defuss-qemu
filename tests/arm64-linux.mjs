// Actual AArch64 Linux execution in the wasm64 runtime, with bounded completion.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Qmp} from '../host/browser/qmp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] || `${here}/../runtime/aarch64`);
const runtime = `${output}/qemu-system-aarch64.js`;
const assets = `${here}/../assets/arm64-smoke`;
// Prefer direct Linux Image boot; EFI zboot can be selected for regression runs.
const kernel = process.env.ARM64_KERNEL || 'Image';
assert.ok(['vmlinuz-virt', 'Image'].includes(kernel));
const label = process.argv[3] || 'verification-arm64-linux';
assert.match(label, /^[a-z0-9-]+$/);
const reportPath = `${here}/../artifacts/${label}.json`, serialPath = `${here}/../artifacts/${label}.log`;
assert.ok(!existsSync(reportPath) && !existsSync(serialPath), 'Use a new report label to preserve earlier evidence');
const started = performance.now();
const hotLimit = Number(process.env.ARM64_HOT_LIMIT || 1500);
const oneInsn = process.env.ARM64_ONE_INSN === '1';
const trace = process.env.ARM64_TRACE === '1';
const noChain = process.env.ARM64_NOCHAIN === '1';
assert.ok(Number.isInteger(hotLimit) && hotLimit >= 16 && hotLimit <= 65535);
const report = {scope: 'AArch64 Linux guest on QEMU wasm64 in Node; not a native host emulator or browser test',
  runtime, node: process.version, kernel, hotLimit, oneInsn, trace, noChain, checks: [], errors: [], status: 'running'};
report.runtimeSha256 = createHash('sha256').update(readFileSync(runtime)).digest('hex');
report.wasmSha256 = createHash('sha256').update(readFileSync(runtime.replace(/\.js$/, '.wasm'))).digest('hex');
let serial = '', mod, timer, panicTimer, finish;
const done = new Promise(resolve => { finish = resolve; });
const qmp = new Qmp();
const args = ['-nodefaults', '-machine', 'virt,gic-version=2', '-cpu', 'cortex-a57',
  '-accel', 'tcg,tb-size=128' + (oneInsn ? ',one-insn-per-tb=on' : ''), '-smp', '1', '-m', '256', '-display', 'none',
  '-monitor', 'none', '-qmp', 'stdio', '-serial', 'file:/guest/serial.log', '-no-reboot',
  '-kernel', '/guest/Image', '-initrd', '/guest/initramfs',
  '-append', 'console=ttyAMA0 earlycon=pl011,0x9000000 rdinit=/init panic=-1 loglevel=7',
  '-drive', 'if=none,id=virtio,file=/guest/virtio.raw,format=raw',
  '-device', 'virtio-blk-device,drive=virtio',
  '-drive', 'if=none,id=nvme,file=/guest/nvme.raw,format=raw',
  '-device', 'nvme,drive=nvme,serial=ARM64SMOKE',
  '-netdev', 'hubport,id=net0,hubid=0', '-device', 'virtio-net-device,netdev=net0'];
if (trace) args.push('-d', 'in_asm,op,op_opt,out_asm,cpu' + (noChain ? ',nochain' : ''), '-dfilter',
  '0xffff8000801c4610..0xffff8000801c4710', '-D', '/guest/tb.log');
else if (noChain) args.push('-d', 'nochain');
report.arguments = [...args];
function save() {
  writeFileSync(serialPath, serial);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
function stop(error) {
  clearTimeout(timer);
  clearTimeout(panicTimer);
  report.status = error ? 'failed' : 'passed';
  if (error) report.failure = String(error.stack || error);
  report.seconds = (performance.now() - started) / 1000;
  if (mod?.pcJitPool) report.jitPool = mod.pcJitPool();
  if (trace && mod?.FS.analyzePath('/guest/tb.log').exists) {
    writeFileSync(`${output}/${label}-tb.log`, mod.FS.readFile('/guest/tb.log'));
  }
  save();
  console.log(JSON.stringify(report, null, 2));
  process.exit(error ? 1 : 0);
}
process.on('uncaughtException', stop);
process.on('unhandledRejection', stop);
timer = setTimeout(() => stop(Error('ARM64 Linux test exceeded 300 seconds')), 300000);
const {default: factory} = await import(pathToFileURL(runtime));
const decoder = new TextDecoder();
factory({arguments: args, mainScriptUrlOrBlob: runtime,
  printErr: message => report.errors.push(String(message)),
  onAbort: error => stop(Error(String(error))),
  preRun: [m => {
    mod = m;
    m._defuss_set_hot_limit(hotLimit);
    m.FS.mkdir('/guest');
    m.FS.writeFile('/guest/Image', readFileSync(`${assets}/${kernel}`));
    m.FS.writeFile('/guest/initramfs', readFileSync(`${assets}/initramfs-smoke.cpio.gz`));
    for (const name of ['virtio', 'nvme']) m.FS.writeFile(`/guest/${name}.raw`, new Uint8Array(2*1024*1024));
    m.FS.writeFile('/guest/serial.log', new Uint8Array());
    const node = m.FS.lookupPath('/guest/serial.log').node, ops = node.stream_ops;
    node.stream_ops = {...ops, write(stream, bytes, offset, count, position) {
      const result = ops.write(stream, bytes, offset, count, position);
      serial += decoder.decode(new Uint8Array(bytes.subarray(offset, offset+count)), {stream: true});
      writeFileSync(serialPath, serial);
      if ((serial.includes('ARM64_SMOKE_FAIL:') || serial.includes('Kernel panic')) && !panicTimer) {
        // Let the complete failure line/backtrace arrive before stopping.
        panicTimer = setTimeout(() => finish('guest-failure'), 500);
      }
      if (serial.includes('ARM64_SMOKE_PASS')) finish('guest-pass');
      return result;
    }};
    m.TTY.default_tty_ops.get_char = qmp.input.read;
    m.TTY.stream_ops.poll = qmp.input.poll;
    const oldWrite = m.TTY.stream_ops.write;
    m.TTY.stream_ops.write = (s,b,o,n,p) => {
      if (s.tty?.ops === m.TTY.default_tty_ops) {
        qmp.accept(new Uint8Array(b.buffer, b.byteOffset+o, n)); return n;
      }
      return oldWrite(s,b,o,n,p);
    };
  }]
}).catch(stop);
await qmp.greeting;
await qmp.send('qmp_capabilities');
report.cpus = await qmp.send('query-cpus-fast');
assert.equal(report.cpus[0].target, 'aarch64');
report.checks.push('QMP reports aarch64 vCPU');
report.blockDevices = await qmp.send('query-block');
assert.equal(await done, 'guest-pass', serial.slice(-4000));
for (const marker of ['ARM64_LINUX_BOOT:aarch64:', 'ARM64_STORAGE_OK:vda',
  'ARM64_STORAGE_OK:nvme0n1', 'ARM64_NET_DEVICE_OK:', 'ARM64_SMOKE_PASS']) {
  assert.ok(serial.includes(marker), `Missing guest marker: ${marker}`);
  report.checks.push(marker);
}
for (const [disk, guestName] of [['virtio','vda'], ['nvme','nvme0n1']]) {
  const image = mod.FS.readFile(`/guest/${disk}.raw`);
  assert.equal(image.length, 2*1024*1024, `Unexpected ${disk} disk size`);
  const expected = Buffer.alloc(2*1024*1024);
  expected.write(`QEMU_WASM_ARM64_${guestName}`);
  assert.deepEqual(Buffer.from(image), expected, `Unexpected writes to ${disk} disk`);
  report.checks.push(`${disk}: entire 2 MiB image matches independently constructed expected bytes`);
}
report.networkScope = 'Guest driver initialization only; external packet transport is not exercised';
stop();
