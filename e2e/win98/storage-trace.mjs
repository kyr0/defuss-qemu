import {attach, artifacts} from '../config.mjs';
import { writeFile } from 'node:fs/promises';

const {browser,page} = await attach();
if (!page) throw new Error('Storage VM page not found');

await page.locator('#record').evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Recording');
await page.locator('#screen').focus();
async function command(text) {
  await page.keyboard.type(text, { delay: 100 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
}
await command('md TEMP');
await command('md TEMP\\DLLCOPY');
await command('copy COMMAND.COM TEMP\\DLLCOPY');
await page.waitForTimeout(30000);
await page.locator('#screen').screenshot({ path: artifacts + '/copy-progress.png' });
await page.keyboard.press('Control+c');
await page.waitForTimeout(500);
await page.locator('#record').evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector('#trace-status')?.textContent === 'Stopped');
const trace = await page.evaluate(() => window.probeRecorder.export());
await writeFile(artifacts + '/storage-trace.json', JSON.stringify(trace));
console.log(JSON.stringify({ durationMs: trace.durationMs, samples: trace.samples.length, metadata: trace.metadata }));
process.exit(0);
