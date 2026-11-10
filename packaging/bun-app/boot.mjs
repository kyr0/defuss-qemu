import {snapshotReady} from './snapshot-ready.mjs';
globalThis.bunWasm = Object.freeze({snapshotReady});
await import('./app.mjs');
snapshotReady();
