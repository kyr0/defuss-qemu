export const romNames = ['bios-256k.bin', 'kvmvapic.bin', 'vgabios-stdvga.bin','vgabios-cirrus.bin'];

export function serialInput() {
  const chunks = [];
  let head = 0, offset = 0;
  const waiters = new Set();
  return {
    read() {
      if(head===chunks.length)return;
      const chunk=chunks[head],byte=chunk[offset++];
      if(offset===chunk.length){
        offset=0;head++;
        if(head===chunks.length){chunks.length=0;head=0;}
        else if(head>=128 && head*2>=chunks.length){chunks.splice(0,head);head=0;}
      }
      return byte;
    },
    push(bytes) {
      if (!bytes.length) return;
      chunks.push(Uint8Array.from(bytes));
      for (const notify of [...waiters]) notify(1);
    },
    poll(stream, _timeout, notify) {
      const mode = stream.flags & 3;
      const writable = mode !== 0 ? 4 : 0; // POLLOUT
      if (mode === 1) return writable;
      if (head < chunks.length) return writable | 1; // POLLIN
      if (notify) {
        waiters.add(notify);
        notify.registerCleanupFunc(() => waiters.delete(notify));
      }
      return writable;
    }
  };
}
