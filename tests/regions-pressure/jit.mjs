// Exact pinned QEMU x-query-jit text, read only while the guest is stopped.
// Translation storage includes TB structs/padding. It is not native JIT memory.
export function parseTranslationBuffer(response,tbMiB=256){
 const text=response?.['human-readable-text'];
 if(typeof text!=='string'||text.length===0||text.length>32768)throw Error('Invalid bounded x-query-jit response');
 const one=(pattern,label)=>{const found=[...text.matchAll(pattern)];if(found.length!==1)throw Error('Missing/duplicate x-query-jit '+label);return found[0].slice(1).map(value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid x-query-jit integer');return n;});};
 const [usedBytes,capacityBytes]=one(/^gen code size[ \t]+(\d+)\/(\d+)[ \t]*\r?$/gm,'gen code size');
 const [tbCount]=one(/^TB count[ \t]+(\d+)[ \t]*\r?$/gm,'TB count');
 const [flushCount]=one(/^TB flush count[ \t]+(\d+)[ \t]*\r?$/gm,'TB flush count');
 if(tbMiB!==256||capacityBytes<=255*1048576||capacityBytes>256*1048576||usedBytes>capacityBytes||!tbCount)throw Error('Unexpected256MiB translation-buffer occupancy/capacity');
 return {schema:1,command:'x-query-jit',configuredTbMiB:tbMiB,usedBytes,capacityBytes,tbCount,flushCount,
  scope:'TCG translation buffer used/capacity, including TB structs and padding; not native/live generated-function memory. Capacity is below256MiB because guard/highwater space is reserved.'};
}
export function validateTranslationBuffer(row){
 if(row.jitError)throw Error('Stopped x-query-jit failed: '+row.jitError);
 if(row.jitStatus?.running!==false||row.jitStatus.status!=='paused')throw Error('x-query-jit must finish while paused');
 const value=parseTranslationBuffer(row.jitRaw);
 if(value.flushCount!==row.counters.counters.flushes)throw Error('Native/M3 global TB flush counts differ');
 return value;
}
