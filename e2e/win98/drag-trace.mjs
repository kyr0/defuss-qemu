import {attach, artifacts} from '../config.mjs';
import { writeFile } from 'node:fs/promises';
const {browser,page} = await attach();
if (!page) throw new Error('Generation VM not found');

await page.bringToFront();
await page.locator('#record').evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Recording');
const canvas = page.locator('#screen'), box = await canvas.boundingBox();
await page.mouse.click(box.x+500,box.y+125);
await page.mouse.down();
for (let cycle=0; cycle<4; cycle++) {
  await page.mouse.move(box.x+700,box.y+300,{steps:15});
  await page.mouse.move(box.x+300,box.y+400,{steps:15});
  await page.mouse.move(box.x+500,box.y+125,{steps:15});
  await page.waitForTimeout(500);
}
await page.mouse.up();
await page.waitForTimeout(1000);
await page.locator('#record').evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Stopped');
const trace = await page.evaluate(() => window.probeRecorder.export());
await writeFile(artifacts + '/drag-trace.json', JSON.stringify(trace));
await page.locator('#screen').screenshot({ path: artifacts + '/after-drag.png' });
console.log(JSON.stringify({durationMs:trace.durationMs,samples:trace.samples.length}));
process.exit(0);
