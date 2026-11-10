const architectures = new Set(['x86_64', 'i386', 'aarch64']);

export function runtimeURL(architecture = 'x86_64') {
  if (!architectures.has(architecture)) throw new RangeError('Unsupported architecture: ' + architecture);
  return new URL(`./runtime/${architecture}/qemu-system-${architecture}.js`, import.meta.url);
}

export function firmwareURL(name) {
  if (!/^[a-z0-9_-]+\.bin$/.test(name)) throw new TypeError('Expected a firmware filename');
  return new URL('./firmware/' + name, import.meta.url);
}

export async function createQemu({architecture = 'x86_64', msg1 = true, ...options} = {}) {
  if (typeof msg1 !== 'boolean') throw new TypeError('msg1 must be boolean');
  const url = runtimeURL(architecture);
  const {default: factory} = await import(url.href);
  // Workers must start on the page's origin. The module import retains the
  // runtime URL so its Wasm and dependency URLs still resolve on the CDN.
  const script = options.mainScriptUrlOrBlob ?? (typeof location !== 'undefined' ? url.href : undefined);
  return factory({...options, mainScriptUrlOrBlob: workerScript(script),
    onRuntimeInitialized() {
      configureCandidate(this, msg1);
      options.onRuntimeInitialized?.call(this);
    }});
}
import {configureCandidate} from './host/browser/candidate.mjs';
import {workerScript} from './host/browser/runtime-loader.mjs';

