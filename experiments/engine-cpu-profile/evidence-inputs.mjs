import {verifyInputs} from '../../benchmarks/harness/m2-msg1-timing/identity.mjs';

// Historical captures bind the original package metadata and Bun launcher,
// recovered from the verified checkpoint. Diagnostic drivers and installed
// dependencies remain checked live. New launchers require fresh guest tests;
// historical verification does not validate the new release or a new capture.
const metadata = {
  'package.json': 'manifests/history/engine-capture-package.json',
  'package-lock.json': 'manifests/history/engine-capture-package-lock.json',
  'packaging/bun-app/vm.mjs': 'manifests/history/engine-capture-bun-vm.mjs',
  'packaging/bun_app_package.py': 'manifests/history/engine-capture-bun-package.py',
};
export function verifyRetainedInputs(root, inputs) {
  return verifyInputs(root, Object.fromEntries(Object.entries(inputs).map(
    ([path, identity]) => [metadata[path] || path, identity],
  )));
}
