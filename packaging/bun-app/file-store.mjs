import {mkdir, readFile, open, link, unlink} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {packRecord, unpackRecord} from './snapshots.mjs';

// A cache may have been created recursively just before publication. Flush
// the entire directory chain, including each newly created child's parent,
// before acknowledging durable capture. A racing publisher may have created
// the chain, so mkdir's return value alone cannot identify all pending entries.
async function syncDirectoryChain(directory) {
  for (let current = resolve(directory);;) {
    const handle = await open(current, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function fileSnapshotStore(directory) {
  const path = key => {
    if (!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(key)) throw Error('Invalid snapshot key');
    return resolve(directory, key + '.snapshot');
  };
  return {
    async get(key) {
      try { return unpackRecord(await readFile(path(key))); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async putIfAbsent(key, record) {
      const target = path(key);
      await mkdir(dirname(target), {recursive: true});
      const temporary = target + '.' + randomUUID() + '.tmp';
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(packRecord(record)); await file.sync(); }
        finally { await file.close(); }
        try {
          await link(temporary, target);
          await syncDirectoryChain(dirname(target));
          return true;
        }
        catch (error) { if (error.code === 'EEXIST') { await syncDirectoryChain(dirname(target)); return false; } throw error; }
      } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    },
    async delete(key) { await unlink(path(key)).catch(e => { if (e.code !== 'ENOENT') throw e; }); },
    async close() {},
  };
}
