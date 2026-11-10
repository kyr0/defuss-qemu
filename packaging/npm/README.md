# defuss-qemu npm package

VERIFIED: The local package contains the selected MSG1 build for x86-64, i386
and ARM64, browser modules, five PC firmware files, notices and corresponding
source. Guest images and snapshots are excluded. Publication to npm has not
been performed; CDN URLs below apply after publication.

## Build and consume

VERIFIED: Selection checks the completed build's source fingerprint and six
binary hashes. It refuses to replace `runtime/current/`. Packaging verifies
that selection, preserves the previous `dist/` under project `tmp/`, and writes
each tarball to a fresh `output/npm/` directory.

```mermaid
flowchart LR
    B["Pinned SDK build"] --> S["Verified runtime selection"]
    S --> P["Npm tarball with source"]
    P --> C["Clean browser consumer"]
```

In a fresh checkout with the SDK configured as described in the root README:

```sh
python3 -B scripts/sdk.py python3 scripts/build.py --output artifacts/release-build --jobs 6
python3 -B packaging/npm/select-runtime.py --build artifacts/release-build
python3 -B scripts/with-tmp.py -- python3 -B packaging/npm/pack.py
```

`output/npm/latest.json` records the tarball path, actual compressed and unpacked
sizes, integrity and per-runtime hashes. Use a fresh build label for another
build. Preserve an earlier runtime selection before selecting another one.
`python3 -B packaging/npm/check.py` builds a tarball, installs it offline in a
clean consumer and tests real guest video, keyboard input and CD staging in
Chrome from both the page origin and a separate origin. `make e2e` includes it.

## Browser API

VERIFIED: `createQemu(options)` loads the generated Emscripten factory and
enables MSG1 before guest translation. `architecture` accepts `x86_64` (default),
`i386` or `aarch64`; `msg1: false` selects the control path. Other options are
passed to Emscripten. Native initialization belongs in `onRuntimeInitialized`.
`runtimeURL(architecture)` resolves a generated module;
`firmwareURL(filename)` resolves a firmware asset. Neither function downloads
an operating-system image.

After publishing version 0.1.0, a browser application can import the loader:

```js
import {createQemu, runtimeURL, firmwareURL} from
  'https://cdn.jsdelivr.net/npm/defuss-qemu@0.1.0/dist/index.mjs';

const biosURL = firmwareURL('bios-256k.bin');
const runtime = runtimeURL('x86_64');
// Supply guest arguments and stage its files in onRuntimeInitialized.
```

VERIFIED: The tested browser environment is Chrome 157 with memory64, shared
WebAssembly memory and cross-origin isolation. Serve the application with
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. Remote JavaScript and Wasm files
must allow CORS. The loader supplies the Blob bootstrap needed for a remote
ES-module worker. When a Content Security Policy is present, it must permit
the runtime imports, Blob workers and WebAssembly compilation.

VERIFIED: Node can import `createQemu` from an installed `defuss-qemu` package.
The instruction acceptance driver consumes that installed API. The browser
Bun test loads the installed host and runtime from a separate origin, closes
Chrome, then restores the app from IndexedDB in a separate Chrome process.

## Binary sizes

VERIFIED: These are the selected three-target build's Wasm sizes. Gzip uses
level 9; these are byte counts divided by 1,048,576, not a CDN transfer estimate.

| Runtime | Wasm MiB | Gzip MiB |
| --- | ---: | ---: |
| x86-64 | 12.75 | 3.54 |
| i386 | 12.66 | 3.52 |
| ARM64 | 21.38 | 5.09 |

VERIFIED: Each JavaScript loader is about 185 KiB, or 44 KiB with gzip. The
local package is about 50 MiB compressed and 85 MiB unpacked, including all
three runtimes and the source archive. A browser loading one architecture
does not need to fetch the source archive or the other runtimes. Exact package
sizes are recorded per tarball because documentation and source changes affect
the archive size.

## Scope and preservation

VERIFIED: `manifests/runtime-selected.json` identifies the selected binaries.
Historical RNDS2 binaries and measurements retain their paths and hashes.
The MSG1 timing confidence intervals cross parity; release selection records
the user's architectural preference and does not establish a speed gain or
performance non-regression.

VERIFIED: The GPL text, inherited firmware notices and third-party notices
travel with the package. `dist/source.tar.gz` contains the imported QEMU tree,
local integration and build scripts. Windows installation media, SliTaz,
FreeDOS, Linux/Bun assets and user disks remain local inputs.
