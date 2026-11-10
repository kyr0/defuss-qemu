// Diagnostic reads only: fixed single-vCPU PC RAM, after a confirmed stop.
// QMP pmemsave reads physical addresses without changing guest page tables.
export function stoppedMemoryReader({qmp, fs, ramBytes = 512 * 1024 * 1024}) {
  if (ramBytes !== 512 * 1024 * 1024) throw Error('Code inspection requires the fixed 512 MiB PC configuration');
  let sequence = 0, busy = false;
  const stopped = async () => {
    const status = await qmp.send('query-status');
    if (status.running !== false || status.status !== 'paused') throw Error('Code inspection requires a paused VM');
  };
  return {
    async readRegisters() {
      await stopped();
      const text = await qmp.send('human-monitor-command', {'command-line': 'info registers'});
      if (typeof text !== 'string' || text.length > 65536) throw Error('Invalid bounded register response');
      return text;
    },
    async readPhysical(address, length) {
      if (!Number.isSafeInteger(address) || !Number.isSafeInteger(length) ||
          address < 1024 * 1024 || length < 1 || length > 4096 || address > ramBytes - length) {
        throw RangeError('Physical inspection must stay in ordinary PC RAM [1 MiB, 512 MiB), at most 4096 bytes');
      }
      if (busy) throw Error('Physical inspection reads must be serialized');
      busy = true;
      let owned = false;
      const filename = `/defuss-m1-code-${++sequence}.bin`;
      try {
        await stopped();
        // Exclusive reservation prevents pmemsave from overwriting an unrelated file.
        // Emscripten accepts C numeric flags but has no Node-style 'wx' mode.
        // Pinned runtime FS.open uses O_WRONLY=1, O_CREAT=64, O_EXCL=128.
        const stream = fs.open(filename, 1 | 64 | 128); owned = true; fs.close(stream);
        await qmp.send('pmemsave', {val: address, size: length, filename});
        const data = fs.readFile(filename);
        if (!(data instanceof Uint8Array) || data.length !== length) throw Error('Physical inspection returned the wrong byte count');
        return data.slice();
      } finally {
        try { if (owned) fs.unlink(filename); } finally { busy = false; }
      }
    },
  };
}
