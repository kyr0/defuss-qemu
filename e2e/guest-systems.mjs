import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {startServer} from './server.mjs';
import {root, artifacts, chromeOptions, newRun, save} from './config.mjs';
import {slitazUI} from './slitaz-ui.mjs';

const guest = process.argv[2];
assert.ok(['freedos','busybox','slitaz'].includes(guest), 'Specify freedos, busybox or slitaz');
assert.ok(process.env.DEFUSS_QEMU_PACKAGE, 'Guest acceptance consumes the installed npm artifact');
await newRun();
const disk = resolve(root, guest === 'freedos' ? 'assets/acceptance-01/freedos.img' : 'assets/slitaz/slitaz-core-x86_64-cooking.iso');
const media = guest === 'busybox' ? {kernel:resolve(root,'assets/bun/amd64/vmlinuz-virt'),initrd:resolve(root,'assets/acceptance-01/busybox.cpio.gz')} : {};
const inputs = guest === 'busybox' ? Object.values(media) : [disk];
const identity = async path => {const data=await readFile(path);return {bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};};
const before = Object.fromEntries(await Promise.all(inputs.map(async p => [p,await identity(p)])));
const report = {status:'failed',guest,inputs:before,checks:[]};
report.packageRoot = resolve(process.env.DEFUSS_QEMU_PACKAGE);
report.packageManifest = await identity(resolve(report.packageRoot,'dist/manifest.json'));
report.harness = Object.fromEntries(await Promise.all(['e2e/guest-systems.mjs','e2e/slitaz-ui.mjs','e2e/server.mjs','e2e/config.mjs','e2e/web/win9x-ui.mjs','e2e/web/win9x.html'].map(async p=>[p,await identity(resolve(root,p))])));
let server,browser,page,timer;
const errors=[];
async function typeGuest(text) {
  const symbols={' ':'Space','\\':'Backslash',':':'Shift+Semicolon','_':'Shift+Minus','>':'Shift+Period',
    '.':'Period','/':'Slash','-':'Minus',';':'Semicolon',"'":'Quote','"':'Shift+Quote','=':'Equal',
    '(':'Shift+Digit9',')':'Shift+Digit0','$':'Shift+Digit4','&':'Shift+Digit7','|':'Shift+Backslash'};
  for(const char of text) {
    const key=/^[a-z]$/i.test(char)?(char===char.toUpperCase()?'Shift+':'')+'Key'+char.toUpperCase():
      /^[0-9]$/.test(char)?'Digit'+char:symbols[char];
    assert.ok(key,'Unsupported guest key '+char);await page.keyboard.press(key,{delay:70});
  }
}
async function waitFor(read, match, timeout=180000, interval=300) {
  const deadline=Date.now()+timeout;let value;
  do {value=await read();if(match(value))return value;await page.waitForTimeout(interval);} while(Date.now()<deadline);
  throw Error('Guest deadline; last observation: '+JSON.stringify(value));
}
try {
  server=await startServer({media});report.runtime=server.identities;
  browser=await chromium.launch(chromeOptions);
  timer=setTimeout(()=>void browser.close(),guest==='slitaz'?1800000:480000);
  page=await browser.newPage({viewport:{width:1280,height:1050}});
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(server.demoUrl,{waitUntil:'networkidle'});
  if(guest==='busybox') {
    await page.evaluate(async()=>{
      const {createQemu}=await import('/package/dist/index.mjs');
      const {Qmp}=await import('/host/browser/qmp.mjs');
      const {attachCom1}=await import('/package/dist/packaging/bun-app/serial.mjs');
      const bytes=async path=>{const r=await fetch(path);if(!r.ok)throw Error(path);return new Uint8Array(await r.arrayBuffer());};
      const kernel=await bytes('/guest-media/kernel'),initrd=await bytes('/guest-media/initrd'),roms={};
      for(const n of ['bios-256k.bin','kvmvapic.bin','linuxboot_dma.bin'])roms[n]=await bytes('/firmware/'+n);
      const qmp=new Qmp(),decoder=new TextDecoder();
      const vm=window.linux={serial:'',errors:[],qmp};
      createQemu({arguments:['-nodefaults','-machine','pc,acpi=off','-cpu','max','-smp','1','-m','256','-accel','tcg,tb-size=128','-display','none','-monitor','none','-qmp','stdio','-no-reboot','-L','/rom',
        '-chardev','file,id=console,path=/dev/app-com1,input-path=/dev/app-com1','-serial','chardev:console',
        '-kernel','/guest/kernel','-initrd','/guest/initrd','-append','console=ttyS0 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on'],
        printErr:s=>vm.errors.push(String(s)),onAbort:e=>vm.errors.push(String(e)),
        onRuntimeInitialized(){
          const m=this;
          vm.module=m;m._defuss_set_hot_limit(1500);m._defuss46_settings(3);
          m.FS.mkdir('/guest');m.FS.mkdir('/rom');m.FS.writeFile('/guest/kernel',kernel);m.FS.writeFile('/guest/initrd',initrd);
          for(const [n,b]of Object.entries(roms))m.FS.writeFile('/rom/'+n,b);
          vm.port=attachCom1(m,data=>{vm.serial+=decoder.decode(data,{stream:true});});
          m.TTY.default_tty_ops.get_char=qmp.input.read;m.TTY.stream_ops.poll=qmp.input.poll;
          const old=m.TTY.stream_ops.write;
          m.TTY.stream_ops.write=(s,b,o,n,p)=>{if(s.tty?.ops===m.TTY.default_tty_ops){qmp.accept(b.subarray(o,o+n));return n;}return old(s,b,o,n,p);};
        }}).catch(e=>vm.errors.push(String(e)));
      await qmp.greeting;await qmp.send('qmp_capabilities');
    });
    const serial=()=>page.evaluate(()=>window.linux.serial);
    await waitFor(serial,text=>text.includes('DEFUSS_BUSYBOX_READY'));
    await page.evaluate(()=>window.linux.port.write("printf '\\nDEFUSS_INTERACTIVE_OK\\n'; cat /tmp/defuss.txt\n"));
    report.serial=await waitFor(serial,text=>/\r?\nDEFUSS_INTERACTIVE_OK\r?\n/.test(text)&&text.lastIndexOf('busybox-file-ok')>text.lastIndexOf('DEFUSS_INTERACTIVE_OK'));
    assert.match(report.serial,/BusyBox v/);assert.match(report.serial,/x86_64/);assert.doesNotMatch(report.serial,/Kernel panic/);
    report.msg1Status=await page.evaluate(()=>window.linux.module._defuss_m2_msg1_status());
    report.checks.push('Actual BusyBox Linux boot, shell, file write/read and interactive serial command');
  } else {
    await page.locator('#size').selectOption('128');await page.locator('#ram').selectOption(guest==='slitaz'?'512':'64');
    await page.locator('#tb-cache').selectOption('128');await page.locator('#sound-card').selectOption('off');
    if(guest==='slitaz')await page.locator('#video').selectOption('std');
    await page.locator(guest==='freedos'?'#floppy':'#cdrom').setInputFiles(disk);
    await page.locator('#boot').selectOption(guest==='freedos'?'a':'d');
    await page.locator('#start').click();
    await page.waitForFunction(()=>Boolean(window.probePC)||document.querySelector('#status')?.textContent==='Start failed',null,{timeout:60000});
    assert.ok(await page.evaluate(()=>Boolean(window.probePC)),await page.locator('#error').textContent());
    report.msg1Status=await page.evaluate(()=>window.probePC.runtimeSettings.msg1Status);
    if(guest==='freedos') {
      const screen=()=>page.evaluate(()=>window.probePC.textScreen());
      await waitFor(screen,text=>text.includes('DEFUSS_FREEDOS_READY'));
      await page.locator('#screen').focus();
      await typeGuest('ECHO DEFUSS_DOS_FILE_OK>C:\\DEFUSS.TXT');await page.keyboard.press('Enter',{delay:70});
      await page.waitForTimeout(500);
      await typeGuest('TYPE C:\\DEFUSS.TXT');await page.keyboard.press('Enter',{delay:70});
      report.screen=await waitFor(screen,text=>text.slice(text.lastIndexOf('TYPE C:')).includes('\nDEFUSS_DOS_FILE_OK'));
      assert.match(report.screen,/FreeDOS/);report.checks.push('FreeDOS kernel and FreeCOM boot, interactive keyboard and FAT file write/read');
    } else {
      const started=Date.now();
      const state=()=>page.locator('#screen').evaluate(slitazUI);
      report.desktopDetection=await waitFor(state,s=>s.welcome,1500000,1000);
      report.desktopReadyMs=Date.now()-started;
      await page.locator('#screen').screenshot({path:resolve(artifacts,'desktop.png')});
      const box=await page.locator('#screen').boundingBox();
      await page.locator('#screen').click({position:{x:box.width*0.625,y:box.height*0.532},delay:250});
      report.shellDetection=await waitFor(state,s=>s.shell,180000,1000);
      await page.locator('#screen').screenshot({path:resolve(artifacts,'terminal.png')});
      await typeGuest('su');await page.keyboard.press('Enter',{delay:150});
      report.passwordDetection=await waitFor(state,s=>s.password,120000,1000);
      await page.locator('#screen').screenshot({path:resolve(artifacts,'password.png')});
      await typeGuest('root');await page.keyboard.press('Enter',{delay:150});
      report.rootDetection=await waitFor(state,s=>s.root,120000,1000);
      await page.locator('#screen').screenshot({path:resolve(artifacts,'root.png')});
      report.token='DEFUSS_SLITAZ_'+randomUUID().replaceAll('-','');
      await typeGuest('mount /dev/sda1 /mnt; (echo '+report.token+'; cat /etc/slitaz-release; uname -m) >/mnt/RESULT.TXT; sync; cat /mnt/RESULT.TXT');
      await page.keyboard.press('Enter',{delay:150});
      report.file=await waitFor(()=>page.evaluate(async()=>{
        const {FatFsDisk}=await import('/package/dist/host/browser/share/fatfs.mjs');
        const disk=await FatFsDisk.create(await window.probePC.diskImage());disk.mount();
        try{return new TextDecoder().decode(disk.readFile('/RESULT.TXT'));}
        catch(error){if(error.result===4)return '';throw error;}
        finally{disk.unmount();}
      }),text=>text.includes(report.token)&&text.includes('cooking')&&text.includes('x86_64'),120000,2000);
      assert.equal(report.file,report.token+'\ncooking\nx86_64\n');
      report.checks.push('Supplied SliTaz ISO graphical desktop and terminal, root shell, guest FAT write/read and host readback of unique token and OS identity');
    }
    await page.locator('#screen').screenshot({path:resolve(artifacts,'guest.png')});
  }
  assert.ok([0x10002,0x10004].includes(report.msg1Status));assert.deepEqual(errors,[]);report.status='passed';
} catch(error) {
  report.failure=String(error.stack||error);process.exitCode=1;
  if(page)report.uiError=await page.locator('#error').textContent().catch(()=>null);
  if(page)await page.locator('#screen').screenshot({path:resolve(artifacts,'guest-failure.png')}).catch(()=>{});
  if(page)await page.screenshot({path:resolve(artifacts,'failure.png')}).catch(()=>{});
} finally {
  clearTimeout(timer);report.errors=errors;if(browser)await browser.close();if(server)await server.close();
  const after=Object.fromEntries(await Promise.all(inputs.map(async p=>[p,await identity(p)])));
  report.mediaUnchanged=JSON.stringify(before)===JSON.stringify(after);
  if(!report.mediaUnchanged){report.status='failed';process.exitCode=1;}
  await save('guest.json',report);console.log(JSON.stringify({status:report.status,guest,artifacts,failure:report.failure}));
}
