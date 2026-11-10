import {attach, artifacts} from '../config.mjs';
import { writeFile } from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import { spawn } from 'node:child_process';
const {browser,page} = await attach();
if (!page) throw new Error('Latency VM not found');

for(let i=0;i<5;i++){
  const white=await page.evaluate(() => {
    const c=document.querySelector('#screen'), s=document.createElement('canvas'); s.width=64;s.height=48;
    const x=s.getContext('2d');x.drawImage(c,0,0,64,48);const d=x.getImageData(0,0,64,48).data;let n=0;
    for(let i=0;i<d.length;i+=4)if(d[i]>230&&d[i+1]>230&&d[i+2]>230)n++;
    return n/(64*48);
  });
  if(white<=0.03)break;
  await page.keyboard.press('Alt+F4');
  await page.waitForTimeout(500);
}
await page.bringToFront();
if(await page.locator('#trace-status').innerText()==='Recording'){
  await page.locator('#record').evaluate(button => button.click());
  await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Stopped');
}
await page.locator('#record').evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Recording');
const started = performance.now();
await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./guest-run-win98.mjs',import.meta.url))],{env:{...process.env,COMMAND:'explorer.exe',OUTPUT:artifacts + '/mycomputer-open.png'},stdio:'inherit'});
  child.on('error',reject);
  child.on('exit',code=>code===0?resolve():reject(new Error('guest-run failed: '+code)));
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const sample = document.createElement('canvas'); sample.width=64; sample.height=48;
  window.myCompSample = sample;
});
await page.waitForFunction(() => {
  const source=document.querySelector('#screen'), sample=window.myCompSample, ctx=sample.getContext('2d');
  ctx.drawImage(source,0,0,64,48);
  const d=ctx.getImageData(0,0,64,48).data;
  let white=0;
  for(let i=0;i<d.length;i+=4) if(d[i]>230&&d[i+1]>230&&d[i+2]>230) white++;
  return white/(64*48)>0.08;
}, null, { timeout: 60000, polling: 100 });
if(await page.locator('#trace-status').innerText()==='Recording'){
  await page.locator('#record').evaluate(button => button.click());
  await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Stopped');
}
const trace = await page.evaluate(() => window.probeRecorder.export());
await writeFile(artifacts + '/mycomputer-trace.json', JSON.stringify(trace));
await page.locator('#screen').screenshot({ path: artifacts + '/mycomputer-open.png' });
console.log(JSON.stringify({elapsedMs:performance.now()-started,durationMs:trace.durationMs,samples:trace.samples.length}));
process.exit(0);
