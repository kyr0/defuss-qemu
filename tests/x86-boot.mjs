#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {Qmp} from '../host/browser/qmp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, process.argv[2] || 'runtime/x86_64/qemu-system-x86_64.js');
const label = process.argv[3]; assert.match(label || '', /^[a-z0-9-]+$/);
const reportPath = resolve(root, 'artifacts', label + '.json');
assert.ok(!existsSync(reportPath), 'Use a fresh label');
const qmp = new Qmp(); let mod, log = '', finish;
const done = new Promise(resolve => { finish = resolve; });
const report = {status:'running', runtime, checks:[]};
const timer = setTimeout(() => finish('timeout'), 60000);
try {
  const {default:factory} = await import(pathToFileURL(runtime));
  factory({mainScriptUrlOrBlob:runtime,
    arguments:['-nodefaults','-machine','pc,acpi=off','-m','32','-display','none','-monitor','none','-serial','none','-qmp','stdio','-L','/rom','-debugcon','file:/guest/debug.log','-drive','file=/guest/boot.img,format=raw,if=floppy','-boot','a','-no-reboot'],
    printErr:text => (report.stderr ??= []).push(String(text)), onAbort:e=>finish('abort: '+e),
    preRun:[m=>{
      mod=m;m.FS.mkdir('/rom');m.FS.mkdir('/guest');
      for (const n of ['bios-256k.bin','kvmvapic.bin']) m.FS.writeFile('/rom/'+n,readFileSync(resolve(root,'engine/qemu/pc-bios',n)));
      const image = new Uint8Array(1440*1024), boot = readFileSync(resolve(root,'artifacts/x86-boot.bin'));
      assert.equal(boot.length,512);image.set(boot);m.FS.writeFile('/guest/boot.img',image);
      m.FS.writeFile('/guest/debug.log',new Uint8Array());
      const node=m.FS.lookupPath('/guest/debug.log').node, ops=node.stream_ops;
      node.stream_ops={...ops,write(s,b,o,n,p){const count=ops.write(s,b,o,n,p);log+=new TextDecoder().decode(new Uint8Array(b.subarray(o,o+count)));if(log.includes('DEFUSS_X86_32_OK\n'))finish('pass');if(log.includes('DEFUSS_X86_FAIL'))finish('failure');return count;}};
      m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;
      const write=m.TTY.stream_ops.write;
      m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return write(s,b,o,n,p);};
    }]}).catch(e=>finish(String(e)));
  await Promise.race([qmp.greeting,done.then(s=>{throw Error(s);})]);await qmp.send('qmp_capabilities');
  report.cpus=await qmp.send('query-cpus-fast');
  assert.equal(await done,'pass');assert.ok(log.includes('DEFUSS_X86_16_OK\n'));
  await qmp.send('stop');report.checks=['16-bit boot','protected-mode transition','32-bit arithmetic and branch'];report.status='passed';
} catch(e) {report.status='failed';report.failure=String(e.stack||e);}
clearTimeout(timer);report.console=log;
report.runtimeSha256=createHash('sha256').update(readFileSync(runtime)).digest('hex');
report.wasmSha256=createHash('sha256').update(readFileSync(runtime.replace(/\.js$/,'.wasm'))).digest('hex');
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
process.exit(report.status==='passed'?0:1);
