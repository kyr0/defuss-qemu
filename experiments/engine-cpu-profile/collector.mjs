import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

export async function browserIdentity(cdp) {
  const version = await cdp.send('Browser.getVersion');
  let commandLine;
  try { commandLine = await cdp.send('Browser.getBrowserCommandLine'); }
  catch (error) { commandLine = {unavailable: String(error.message)}; }
  // VERIFIED: this Chrome launch omits --enable-automation, so its command-line
  // endpoint refuses inspection. Read only processes owned by our scratch path.
  const scratch = process.env.TMPDIR;
  assert.ok(scratch?.startsWith(process.cwd() + '/tmp/'));
  const ownedProcesses = execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
    .split('\n').filter(line => line.includes(scratch) && line.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.ok(ownedProcesses.length > 0);
  assert.ok(ownedProcesses.every(line => !line.includes('--js-flags')));
  return {version, commandLine, ownedProcesses};
}

// Diagnostic transport for page and worker isolates. No Debugger domain or
// precise coverage: those have different execution effects from CPU sampling.
export class CpuCollector {
  constructor(cdp, save, interval = 2000) {
    this.cdp = cdp; this.save = save; this.interval = interval;
    this.targets = new Map(); this.pending = new Map(); this.nextId = 1;
    this.segment = null; this.segments = []; this.errors = [];
    cdp.on('Target.receivedMessageFromTarget', event => {
      const message = JSON.parse(event.message);
      const key = `${event.sessionId}:${message.id}`;
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key); clearTimeout(pending.timer);
      if (message.error) pending.reject(Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    cdp.on('Target.targetCreated', ({targetInfo}) => {
      void this.attach(targetInfo).catch(error => this.errors.push(String(error)));
    });
    cdp.on('Target.targetDestroyed', ({targetId}) => {
      const target = this.targets.get(targetId);
      if (target) target.destroyedUtc = new Date().toISOString();
    });
  }

  async send(target, method, params = {}) {
    const id = this.nextId++, key = `${target.sessionId}:${id}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key); reject(Error(`CDP timeout: ${target.info.type} ${method}`));
      }, 60000);
      this.pending.set(key, {resolve, reject, timer});
      this.cdp.send('Target.sendMessageToTarget', {
        sessionId: target.sessionId, message: JSON.stringify({id, method, params}),
      }).catch(error => {
        clearTimeout(timer); this.pending.delete(key); reject(error);
      });
    });
  }

  async attach(info) {
    if (!['page', 'worker'].includes(info.type)) return;
    const prior = this.targets.get(info.targetId);
    if (prior) { prior.info = info; return prior.ready; }
    const target = {info, discoveredUtc: new Date().toISOString(), ordinal: this.targets.size};
    this.targets.set(info.targetId, target);
    target.ready = (async () => {
      const {sessionId} = await this.cdp.send('Target.attachToTarget', {targetId: info.targetId, flatten: false});
      target.sessionId = sessionId;
      await this.send(target, 'Profiler.enable');
      await this.send(target, 'Profiler.setSamplingInterval', {interval: this.interval});
      if (this.segment) await this.startTarget(target, this.segment);
    })().catch(error => { target.error = String(error); throw error; });
    return target.ready;
  }

  async refresh() {
    await this.cdp.send('Target.setDiscoverTargets', {discover: true});
    const {targetInfos} = await this.cdp.send('Target.getTargets');
    await Promise.all(targetInfos.map(info => this.attach(info)));
    await Promise.all([...this.targets.values()].map(target => target.ready));
  }

  async startTarget(target, segment) {
    if (target.recording === segment.id || target.destroyedUtc) return;
    await this.send(target, 'Profiler.start');
    target.recording = segment.id;
    segment.targets.push({targetId: target.info.targetId, ordinal: target.ordinal,
      type: target.info.type, url: target.info.url, startUtc: new Date().toISOString()});
  }

  async start(label) {
    assert.equal(this.segment, null);
    await this.refresh();
    const segment = {id: this.segments.length, label, startUtc: new Date().toISOString(), targets: []};
    this.segments.push(segment); this.segment = segment;
    await Promise.all([...this.targets.values()].map(target => this.startTarget(target, segment)));
  }

  async stop() {
    const segment = this.segment;
    if (!segment) return;
    await this.refresh();
    // Keep the segment active until all pending attaches have started sampling.
    this.segment = null;
    await Promise.all([...this.targets.values()].map(async target => {
      if (target.recording !== segment.id) return;
      const entry = segment.targets.find(row => row.targetId === target.info.targetId);
      try {
        const {profile} = await this.send(target, 'Profiler.stop');
        entry.file = `cpu-${String(segment.id).padStart(2, '0')}-${target.ordinal}.json`;
        entry.samples = profile.samples?.length ?? 0;
        entry.stopUtc = new Date().toISOString();
        await this.save(entry.file, profile);
      } catch (error) { entry.error = String(error); this.errors.push(String(error)); }
      target.recording = null;
    }));
    segment.stopUtc = new Date().toISOString();
    await this.save(`segment-${String(segment.id).padStart(2, '0')}.json`, segment);
  }

  report() {
    return {samplingIntervalMicroseconds: this.interval, errors: this.errors,
      scope: 'Isolate CPU sampling, diagnostic only; not exclusive process CPU, background compiler CPU, or a timing result',
      targets: [...this.targets.values()].map(({ready, ...target}) => target), segments: this.segments};
  }

  async close() {
    await this.stop();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer); pending.reject(Error('Collector closed'));
    }
    this.pending.clear();
    await this.cdp.detach();
  }
}
