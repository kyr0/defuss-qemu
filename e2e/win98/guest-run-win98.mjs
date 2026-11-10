import {attach, artifacts} from '../config.mjs';
import path from 'node:path';
const command = process.env.COMMAND;
if (!command) throw new Error('COMMAND is required');
const output = process.env.OUTPUT ?? artifacts + '/guest-run.png';
const {browser,page} = await attach();
if (!page) throw new Error('v0.6.8 page not found');
await page.evaluate(() => {
  const sample = document.createElement('canvas'); sample.width = 64; sample.height = 48;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  window.vmRunStats = () => {
    ctx.drawImage(document.querySelector('#screen'), 0, 0, 64, 48);
    const d = ctx.getImageData(0, 0, 64, 48).data;
    let grayLeft = 0, grayN = 0, runWhite = 0, runN = 0, runGray = 0, runGrayN = 0;
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (x >= 12 && x <= 20 && y >= 36 && y <= 46) {
        if (r >= 120 && r <= 230 && Math.max(r,g,b)-Math.min(r,g,b)<20) runGray++;
        runGrayN++;
      }
      if (x < 12 && y >= 24 && y < 46) {
        if (r >= 150 && r <= 230 && Math.max(r,g,b)-Math.min(r,g,b)<15) grayLeft++;
        grayN++;
      }
      if (x >= 4 && x <= 20 && y >= 40 && y <= 42) {
        if (r > 230 && g > 230 && b > 230) runWhite++;
        runN++;
      }
    }
    return { grayLeft: grayLeft / grayN, runWhite: runWhite / runN, runGray: runGray / runGrayN };
  };
});
const canvas = page.locator('#screen'), box = await canvas.boundingBox();
await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
await canvas.focus();
for (let attempt = 0; ; attempt++) {
  await page.keyboard.press('Control+Escape');
  try {
    await page.waitForFunction(() => window.vmRunStats().grayLeft > 0.25, null, { timeout: 5000, polling: 100 });
    break;
  } catch (error) { if (attempt === 2) throw error; await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } }); }
}
await page.waitForTimeout(300);
let runMs = null;
for (let attempt = 0; ; attempt++) {
  await page.keyboard.press('r');
  try {
    await page.waitForFunction(() => window.vmRunStats().runGray > 0.4, null, { timeout: 4000, polling: 100 });
    break;
  } catch (error) {
    if (attempt === 2) throw error;
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.keyboard.press('Control+Escape');
    await page.waitForFunction(() => window.vmRunStats().grayLeft > 0.25, null, { timeout: 5000, polling: 100 });
  }
}
await page.waitForTimeout(300);
await page.keyboard.type(command, { delay: 60 });
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
await canvas.screenshot({ path: path.resolve(output) });
console.log(JSON.stringify({ command, output, active: await page.evaluate(() => document.activeElement?.id), status: await page.locator('#status').innerText() }));
process.exit(0);
