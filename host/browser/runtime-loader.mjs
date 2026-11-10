/** Start remote ES-module pthreads on the document's origin. */
export function workerScript(script) {
  if (typeof location === 'undefined' || typeof script !== 'string') return script;
  const url = new URL(script, location.href);
  if (url.origin === location.origin) return script;
  return new Blob(['import ' + JSON.stringify(url.href) + ';'], {type:'text/javascript'});
}
