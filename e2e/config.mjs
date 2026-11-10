import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, access} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const profile = process.env.PROFILE || 'win98-local';
assert.match(profile, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'PROFILE must be a simple run label');
export const artifacts = resolve(root, 'artifacts/e2e', profile);
export const chromeOptions = {
  headless: process.env.HEADFUL !== '1',
  ...(process.env.DEFUSS_VM_CHROME ? {executablePath: process.env.DEFUSS_VM_CHROME} : {})
};
export const cdpPort = Number(process.env.CDP_PORT || 19223);
assert.ok(Number.isInteger(cdpPort) && cdpPort > 0 && cdpPort <= 65535, 'Invalid CDP_PORT');
export const runtimeDir = resolve(root, process.env.RUNTIME_DIR || 'runtime/x86_64');

export async function newRun() {
  await mkdir(dirname(artifacts), {recursive: true});
  await mkdir(artifacts); // Refuse to overwrite evidence from an earlier run.
}
export async function save(name, value) {
  await writeFile(resolve(artifacts, name), JSON.stringify(value, null, 2) + '\n');
}
export async function requireDisk() {
  assert.ok(process.env.WIN98_DISK, 'Set WIN98_DISK to your installed raw Windows 98 disk');
  const disk = resolve(process.env.WIN98_DISK);
  await access(disk);
  return disk;
}
export async function attach() {
  const session = JSON.parse(await readFile(resolve(artifacts, 'session.json'), 'utf8'));
  assert.equal(session.status, 'ready', 'The boot runner is no longer holding a ready VM');
  const browser = await chromium.connectOverCDP(session.cdpUrl);
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === session.demoUrl);
  assert.ok(page, 'Recorded VM page not found');
  // The random token prevents attachment to an unrelated browser reusing the port.
  assert.equal(await page.evaluate(() => window.defussE2eSession), session.token);
  page.setDefaultTimeout(60000);
  return {browser, page, session};
}
