const encoder = new TextEncoder();
export const bytes = value => value instanceof Uint8Array ? value : new Uint8Array(value);
export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const snapshotKey = manifest => manifest.appSha256 + '/' + manifest.compatibilitySha256;

export async function encodeSnapshot(raw, manifest) {
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  return {metadata: {
    schema: 1, appSha256: manifest.appSha256, compatibilitySha256: manifest.compatibilitySha256,
    createdUtc: new Date().toISOString(), encoding: 'gzip', bytes: raw.length, sha256: await sha256(raw),
    compressedBytes: compressed.length, compressedSha256: await sha256(compressed),
  }, data: compressed};
}
export async function decodeSnapshot(record, manifest) {
  const m = record.metadata, data = bytes(record.data);
  if (m?.schema !== 1 || m.encoding !== 'gzip' || m.appSha256 !== manifest.appSha256 || m.compatibilitySha256 !== manifest.compatibilitySha256 ||
      !Number.isSafeInteger(m.bytes) || m.bytes <= 0 || m.bytes > 1024 * 1024 * 1024 ||
      m.compressedBytes !== data.length || await sha256(data) !== m.compressedSha256) throw Error('Snapshot metadata or compressed checksum mismatch');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.length;
    if (length > m.bytes) { await reader.cancel(); throw Error('Snapshot exceeds recorded length'); }
    chunks.push(value);
  }
  const raw = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  if (length !== m.bytes || await sha256(raw) !== m.sha256) throw Error('Snapshot checksum mismatch');
  return raw;
}

export function indexedDBSnapshotStore(name = 'bun-wasm-snapshots-v1') {
  if (!globalThis.indexedDB) throw Error('A persistent snapshot store is required; use fileSnapshotStore in Node');
  const db = new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('snapshots');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  async function transaction(mode, operation) {
    const connection = await db;
    return new Promise((resolve, reject) => {
      const tx = connection.transaction('snapshots', mode, {durability: 'strict'}), request = operation(tx.objectStore('snapshots'));
      let duplicate = false;
      request.onerror = event => {
        if (request.error.name === 'ConstraintError') { duplicate = true; event.preventDefault(); event.stopPropagation(); }
      };
      tx.oncomplete = () => resolve(duplicate ? false : (mode === 'readonly' ? request.result : true));
      tx.onabort = () => reject(tx.error || request.error || Error('Snapshot transaction aborted'));
      tx.onerror = () => {}; // onabort reports the failure.
    });
  }
  return {
    get: key => transaction('readonly', s => s.get(key)),
    putIfAbsent: (key, record) => transaction('readwrite', s => s.add(record, key)),
    delete: key => transaction('readwrite', s => s.delete(key)),
    close: async () => (await db).close(),
  };
}

// One self-contained file permits atomic, no-replace publication on disk.
export function packRecord(record) {
  const header = encoder.encode(JSON.stringify(record.metadata));
  const result = new Uint8Array(12 + header.length + record.data.length);
  result.set(encoder.encode('BWSNAP01'));
  new DataView(result.buffer).setUint32(8, header.length, true);
  result.set(header, 12); result.set(record.data, 12 + header.length);
  return result;
}
export function unpackRecord(value) {
  const raw = bytes(value);
  if (raw.length < 12 || new TextDecoder().decode(raw.subarray(0, 8)) !== 'BWSNAP01') throw Error('Invalid snapshot header');
  const length = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(8, true);
  if (length > 16384 || length + 12 > raw.length) throw Error('Invalid snapshot header length');
  return {metadata: JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + length))), data: raw.subarray(12 + length)};
}
