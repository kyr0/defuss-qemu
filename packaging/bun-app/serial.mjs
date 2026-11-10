import {serialInput} from '../../host/browser/machine.mjs';

/** Attach a duplex host character device; QEMU connects it to guest COM1. */
export function attachCom1(module, onOutput) {
  const input = serialInput(), fs = module.FS;
  const device = fs.makedev(240, 1);
  fs.registerDevice(device, {
    open(stream) { stream.seekable = false; },
    poll: input.poll,
    read(stream, buffer, offset, length) {
      let count = 0;
      while (count < length) {
        const byte = input.read();
        if (byte === undefined) break;
        buffer[offset + count++] = byte;
      }
      if (!count) throw new fs.ErrnoError(6); // EAGAIN, never EOF on an idle UART.
      return count;
    },
    write(stream, buffer, offset, length) {
      // WASM uses shared memory; copy before decoding or retaining the bytes.
      onOutput(new Uint8Array(buffer.subarray(offset, offset + length)));
      return length;
    },
    llseek() { throw new fs.ErrnoError(70); },
  });
  fs.mkdev('/dev/app-com1', 0o600, device);
  return {write: value => input.push(typeof value === 'string' ? new TextEncoder().encode(value) : value)};
}
