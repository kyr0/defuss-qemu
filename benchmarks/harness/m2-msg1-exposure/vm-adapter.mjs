import {readExposure,configureExposure,requirePaused} from './exposure.mjs';
// Diagnostic-only adapter of packaging/bun-app/vm.mjs; see adapter-provenance.json.
import {Qmp} from '../../../host/browser/qmp.mjs';
import {attachCom1} from '../../../packaging/bun-app/serial.mjs';
import {bytes, sha256, canonical, snapshotKey, encodeSnapshot, decodeSnapshot, indexedDBSnapshotStore} from '../../../packaging/bun-app/snapshots.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const encoder = new TextEncoder();
const artifactNames = ['app.mjs', 'kernel', 'initramfs.cpio.gz', 'runtime/qemu-system-x86_64.js', 'runtime/qemu-system-x86_64.wasm', 'rom/bios-256k.bin', 'rom/kvmvapic.bin', 'rom/linuxboot_dma.bin'];

export async function validateManifest(manifest) {
  const {compatibilitySha256, generation, ...spec} = manifest;
  if (manifest.schema !== 1 || manifest.os !== 'linux' || manifest.architecture !== 'amd64' ||
      manifest.image !== 'oven/bun@sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2' ||
      manifest.snapshot?.enabled !== true || manifest.snapshot.protocol !== 'com1-ready-v1' || manifest.snapshot.readyByte !== 49 ||
      generation !== compatibilitySha256 || !/^[a-f0-9]{64}$/.test(generation) ||
      manifest.appSha256 !== manifest.artifacts?.['app.mjs']?.sha256 ||
      canonical(Object.keys(manifest.artifacts).sort()) !== canonical([...artifactNames].sort()) ||
      await sha256(encoder.encode(canonical(spec))) !== compatibilitySha256) throw Error('Invalid or incompatible Bun app manifest');
  return manifest;
}

/** Start a VM. ready resolves after durable capture, or successful restore and ACK. */
export async function startBunApp({manifest, readAsset, runtimeUrl, workerScript = runtimeUrl,
  snapshotStore, helperProfiling = false, onConsole = () => {}, onCom1 = () => {}, onEvent = () => {}, timeoutMs = 180000}) {
  if(helperProfiling)throw Error('MSG1 exposure forbids unrelated helper profiling');
  if(manifest.experiment?.name!=='sha256msg1-v1'||typeof manifest.experiment.enabled!=='boolean')throw Error('Missing bound MSG1 configuration');
  const helperBus = null;
  const started = performance.now();
  const emit = (event, extra = {}) => onEvent({event, atMs: performance.now() - started, ...extra});
  await validateManifest(manifest);
  const store = snapshotStore || indexedDBSnapshotStore(), key = snapshotKey(manifest);
  let snapshot;
  try {
    const record = await store.get(key);
    if (record) { snapshot = await decodeSnapshot(record, manifest); emit('cache-hit', {metadata: record.metadata}); }
    else emit('cache-miss');
  } catch (error) {
    // A damaged record is not a usable snapshot. Rebuild it from a cold boot.
    emit('cache-rejected', {reason: String(error)});
    await store.delete(key);
  }
  const assets = {};
  for (const [name, info] of Object.entries(manifest.artifacts)) {
    const data = bytes(await readAsset(manifest.generation + '/' + name));
    if (data.length !== info.bytes || await sha256(data) !== info.sha256) throw Error('App artifact checksum mismatch: ' + name);
    assets[name] = data;
  }
  const mode = snapshot ? 'restored' : 'cold', qmp = new Qmp();
  let mod, port, captured = !!snapshot, readyDone = false, closed = false, timer, consoleTail = '';
  let exposurePaused=false,configuration;
  let resolveReady, rejectReady, rejectFatal;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fatal = new Promise((_, reject) => { rejectFatal = reject; });
  ready.catch(() => {}); fatal.catch(() => {});
  const fail = error => { clearTimeout(timer); rejectReady(error); rejectFatal(error); emit('error', {reason: String(error)}); };
  const finishReady = extra => {
    if (closed) return;
    readyDone = true; clearTimeout(timer);
    port.write(mode === 'restored' ? 'R' : 'C');
    const result = {mode, appSha256: manifest.appSha256, compatibilitySha256: manifest.compatibilitySha256, readyMs: performance.now() - started, ...extra};
    emit('ready', result); resolveReady(result);
  };
  async function capture() {
    emit('snapshot-start');
    const deadline = performance.now() + timeoutMs;
    while (mod._defuss_local_snapshot(0) === 1) {
      if (closed) return;
      if (performance.now() > deadline) throw Error('VM snapshot deadline exceeded');
      await sleep(10);
    }
    if (mod._defuss_local_snapshot(0) !== 2) throw Error('Native VM snapshot failed');
    const raw = mod.FS.readFile('/milestone-stream');
    mod.FS.unlink('/milestone-stream');
    emit('snapshot-captured', {bytes: raw.length});
    const record = await encodeSnapshot(raw, manifest);
    if (closed) return;
    const saved = await store.putIfAbsent(key, record);
    emit(saved ? 'snapshot-saved' : 'snapshot-already-exists', {metadata: record.metadata});
    finishReady({snapshotSaved: saved, snapshotBytes: record.metadata.compressedBytes});
  }
  const vm = manifest.vm;
  const args = ['-nodefaults', '-machine', vm.machine, '-cpu', vm.cpu, '-accel', 'tcg,tb-size=' + vm.tbMiB,
    '-smp', String(vm.smp), '-m', String(vm.ramMiB), '-display', 'none', '-monitor', 'none', '-qmp', 'stdio',
    '-chardev', 'file,id=app-com1,path=/dev/app-com1,input-path=/dev/app-com1', '-serial', 'chardev:app-com1',
    '-serial', 'file:/guest/console.log', '-parallel', 'none', '-no-reboot', '-L', '/rom',
    '-kernel', '/guest/kernel', '-initrd', '/guest/initramfs', '-append',
    'console=ttyS1 rdinit=/init panic=-1 loglevel=3 random.trust_cpu=on',
    ...(snapshot ? ['-incoming', 'defer'] : [])];
  const {default: factory} = await import(runtimeUrl);
  timer = setTimeout(() => fail(Error('Bun app readiness deadline exceeded')), timeoutMs);
  factory({pcHelperBus: helperBus, arguments: args, mainScriptUrlOrBlob: workerScript,
    printErr: text => emit('stderr', {text: String(text)}), onAbort: error => fail(Error('VM aborted: ' + error)),
    preRun: [m => {
      configuration=configureExposure(m,manifest.experiment.enabled);mod=m;
      m._defuss_set_hot_limit(vm.hotLimit); m._defuss46_settings(vm.runtimeFlags);
      m.FS.mkdir('/guest'); m.FS.mkdir('/rom');
      m.FS.writeFile('/guest/kernel', assets.kernel);
      m.FS.writeFile('/guest/initramfs', assets['initramfs.cpio.gz']);
      for (const [name, data] of Object.entries(assets)) if (name.startsWith('rom/')) m.FS.writeFile('/' + name, data);
      if (snapshot) { m.FS.writeFile('/incoming-stream', snapshot); snapshot = null; }
      port = attachCom1(m, data => {
        if (!captured && data.includes(49)) {
          captured = true;
          // Schedule on QEMU's own AioContext, outside the serial callback.
          m._defuss_local_snapshot(1);
          queueMicrotask(() => capture().catch(fail));
        }
        onCom1(data);
      });
      m.FS.writeFile('/guest/console.log', new Uint8Array());
      const node = m.FS.lookupPath('/guest/console.log').node, ops = node.stream_ops, decoder = new TextDecoder();
      node.stream_ops = {...ops, write(s, b, o, n, p) {
        const count = ops.write(s, b, o, n, p), text = decoder.decode(new Uint8Array(b.subarray(o, o + count)), {stream: true});
        onConsole(text); consoleTail = (consoleTail + text).slice(-512);
        if (consoleTail.includes('BUN_APP_FAILURE:') || consoleTail.includes('Kernel panic')) fail(Error('Guest failed: ' + consoleTail));
        return count;
      }};
      m.TTY.default_tty_ops.get_char = qmp.input.read; m.TTY.stream_ops.poll = qmp.input.poll;
      const old = m.TTY.stream_ops.write;
      m.TTY.stream_ops.write = (s, b, o, n, p) => {
        if (s.tty?.ops === m.TTY.default_tty_ops) { qmp.accept(b.subarray(o, o + n)); return n; }
        return old(s, b, o, n, p);
      };
    }],
  }).catch(fail);
  try {
    await Promise.race([qmp.greeting, fatal]);
    await Promise.race([qmp.send('qmp_capabilities'), fatal]);
    emit('vm-started', {mode});
    if (mode === 'restored') {
      await Promise.race([qmp.send('migrate-incoming', {uri: 'file:/incoming-stream'}), fatal]);
      for (;;) {
        const status = await Promise.race([qmp.send('query-migrate'), fatal]);
        if (status.status === 'completed') break;
        if (status.status === 'failed' || status.status === 'cancelled') throw Error('Snapshot restore failed: ' + JSON.stringify(status));
        await Promise.race([sleep(20), fatal]);
      }
      mod.FS.unlink('/incoming-stream');
      const status = await qmp.send('query-status');
      if (!status.running) throw Error('Restored VM is not running: ' + JSON.stringify(status));
      finishReady({snapshotSaved: false});
    }
  } catch (error) { fail(error); throw error; }
  return {
    mode, ready, key,
    module: mod, helperBus,configuration,
    async pause() { await qmp.send('stop'); const status = await qmp.send('query-status'); requirePaused(status); exposurePaused=true; return status; },
    async resume() { exposurePaused=false; await qmp.send('cont'); },
    stats() { return {jitPool: mod.pcJitPool?.() ?? null}; },
    exposure() { if(!exposurePaused)throw Error('Exposure read requires confirmed stopped VM'); return readExposure(mod); },
    com1: {write(value) {
      if (!readyDone || closed) throw Error('COM1 application input requires a ready VM');
      port.write(value);
    }},
    async stop() {
      if (closed) return;
      closed = true; clearTimeout(timer);
      if (!readyDone) rejectReady(Error('VM stopped before readiness'));
      await qmp.send('stop');
      await store.close?.();
    },
  };
}
