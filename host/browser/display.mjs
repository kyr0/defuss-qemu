// QMP writes P6 rows to this private MEMFS file. Keep its backing array across
// O_TRUNC opens, but reset the logical length so a smaller VGA mode is exact.
export function frameFile(fs, path) {
  fs.writeFile(path, new Uint8Array());
  const node = fs.lookupPath(path).node;
  const ops = node.node_ops;
  node.node_ops = {...ops, setattr(n, attrs) {
    if (attrs.size !== 0) return ops.setattr(n, attrs);
    n.usedBytes = 0;
    const {size, ...metadata} = attrs;
    ops.setattr(n, metadata);
  }};
  node.stream_ops = {...node.stream_ops, write(stream, src, offset, length, pos) {
    if (!length) return 0;
    const end = pos + length;
    if (!node.contents || end > node.contents.length) {
      const next = new Uint8Array(Math.max(end, 65536, (node.contents?.length || 0) * 2));
      if (node.usedBytes) next.set(node.contents.subarray(0, node.usedBytes));
      node.contents = next;
    }
    if (pos > node.usedBytes) node.contents.fill(0, node.usedBytes, pos);
    node.contents.set(src.subarray(offset, offset + length), pos);
    node.usedBytes = Math.max(node.usedBytes, end);
    return length;
  }};
  return () => fs.lookupPath(path).node === node && node.contents
    ? node.contents.subarray(0, node.usedBytes) : fs.readFile(path);
}

const decoder = new TextDecoder();
const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

export class FrameDecoder {
  decode(bytes) {
    const head = decoder.decode(bytes.subarray(0, 64)).match(/^P6\n(\d+) (\d+)\n255\n/);
    if (!head) throw Error('Unrecognized QEMU screendump');
    const w = Number(head[1]), h = Number(head[2]), offset = head[0].length;
    if (!w || !h || w*h > 16777216 || bytes.length-offset !== w*h*3) throw Error('Invalid VGA frame size');
    const resize = this.w !== w || this.h !== h;
    if (resize) {
      this.w = w; this.h = h;
      this.words = new Uint32Array(w*h);
      this.rgba = new Uint8ClampedArray(this.words.buffer);
    }
    const words = this.words;
    let first = h, last = -1, p = 0, j = offset;
    for (let y = 0; y < h; y++) {
      let changed = false;
      const end = p + w;
      for (; p < end; p++, j+=3) {
        const color = (littleEndian
          ? 0xff000000 | bytes[j] | bytes[j+1]<<8 | bytes[j+2]<<16
          : bytes[j]<<24 | bytes[j+1]<<16 | bytes[j+2]<<8 | 255) >>> 0;
        if (words[p] !== color) { words[p] = color; changed = true; }
      }
      if (changed) { if (first === h) first = y; last = y; }
    }
    return {w, h, rgba:this.rgba, dirtyY:resize ? 0 : first, dirtyH:resize ? h : Math.max(0,last-first+1)};
  }
}
