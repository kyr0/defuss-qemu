// DEFUSS_M2_RESOURCE_OBSERVER_BEGIN
// Diagnostic module-input accounting. This is not native JIT resident memory.
var pcResourceWords;
function pcResourceState() {
  if (!pcResourceWords) {
    const bus = Module.pcResourceBus;
    if (!bus || bus.schema !== 1 || !(bus.buffer instanceof SharedArrayBuffer) || bus.buffer.byteLength !== 80)
      throw Error('Missing resource observer bus');
    pcResourceWords = new BigUint64Array(bus.buffer);
  }
  return pcResourceWords;
}
function pcResourceAdd(words, index, value) {
  const n = BigInt(value), old = Atomics.add(words, index, n);
  if (old + n >= 0x10000000000000000n) Atomics.store(words, 9, 1n);
}
function pcResourceMax(words, index, value) {
  const n = BigInt(value);
  for (let old = Atomics.load(words, index); old < n;) {
    const seen = Atomics.compareExchange(words, index, old, n);
    if (seen === old) return;
    old = seen;
  }
}
function pcResourceAttempt(moduleBytes, importBytes) {
  if (!Number.isSafeInteger(moduleBytes) || moduleBytes <= 0 || !Number.isSafeInteger(importBytes) || importBytes < 0 || importBytes % 8)
    throw Error('Invalid resource observer lengths');
  const words = pcResourceState();
  pcResourceAdd(words, 0, 1); pcResourceAdd(words, 1, moduleBytes); pcResourceAdd(words, 2, importBytes);
  pcResourceMax(words, 3, moduleBytes);
}
function pcResourceCompiled() { pcResourceAdd(pcResourceState(), 4, 1); }
function pcResourceInstantiated(moduleBytes, importBytes) {
  const words = pcResourceState();
  pcResourceAdd(words, 5, 1); pcResourceAdd(words, 6, moduleBytes); pcResourceAdd(words, 7, importBytes);
  pcResourceMax(words, 8, moduleBytes);
}
// DEFUSS_M2_RESOURCE_OBSERVER_END
