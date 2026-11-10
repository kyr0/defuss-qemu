// @bun
// operations.ts
import { createHash } from "crypto";
function createWorkloads() {
  const records = Array.from({ length: 128 }, (_, i) => ({ id: i, name: "record-" + i, value: i * 7, active: i % 2 === 0, text: "abcdef0123456789".repeat(4) }));
  const payload = JSON.stringify(records);
  const bytes = Buffer.alloc(65536);
  for (let i = 0;i < bytes.length; i++)
    bytes[i] = i * 17 + 23 & 255;
  const responseBody = JSON.stringify({ ok: true, value: "benchmark-response-".repeat(8) });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(responseBody, { headers: { "content-type": "application/json" } }) });
  const jobs = {
    integer() {
      let x = 123;
      for (let i = 0;i < 250000; i++)
        x = Math.imul(x ^ i, 1664525) + 1013904223 >>> 0;
      return x;
    },
    json() {
      let x = 0;
      for (let i = 0;i < 8; i++) {
        const o = JSON.parse(payload);
        x += o[127].id + JSON.stringify(o).length;
      }
      return x;
    },
    sha256() {
      let x = "";
      for (let i = 0;i < 16; i++)
        x = createHash("sha256").update(bytes).digest("hex");
      return x;
    },
    async http() {
      let n = 0;
      for (let i = 0;i < 8; i++) {
        const r = await fetch(server.url);
        const body = await r.text();
        if (body !== responseBody || r.status !== 200)
          throw Error("HTTP correctness");
        n += body.length;
      }
      return n;
    }
  };
  return { jobs, stop: () => server.stop(true), parameters: { integerIterations: 250000, jsonRecords: 128, jsonRounds: 8, shaBytes: 65536, shaRounds: 16, httpRequests: 8 } };
}

// main.ts
var emit = (value) => console.log("BUN_BENCH " + JSON.stringify(value));
emit({ event: "ready", bun: Bun.version, revision: Bun.revision, arch: process.arch, pid: process.pid });
var expected = JSON.parse(process.env.BENCH_EXPECTED);
try {
  const app = createWorkloads(), names = Object.keys(app.jobs);
  emit({ event: "parameters", ...app.parameters, batchRepetitions: 20, samples: 3, warmupCycles: 10 });
  emit({ event: "warmup-start", cycles: 10 });
  for (let cycle = 0;cycle < 10; cycle++)
    for (const name of names) {
      const value = await app.jobs[name]();
      if (value !== expected[name])
        throw Error("Warmup mismatch: " + name + " " + value);
    }
  emit({ event: "warmup-complete", cycles: 10 });
  const orders = [names, [...names].reverse(), [...names.slice(1), names[0]]];
  for (let sample = 0;sample < orders.length; sample++)
    for (const name of orders[sample]) {
      emit({ event: "start", name, sample, iterations: 20 });
      const begin = performance.now();
      let value;
      for (let iteration = 0;iteration < 20; iteration++) {
        value = await app.jobs[name]();
        if (value !== expected[name])
          throw Error("Result mismatch: " + name + " " + value);
      }
      emit({ event: "result", name, sample, iterations: 20, guestMs: performance.now() - begin, value });
    }
  await app.stop();
  emit({ event: "complete" });
} catch (error) {
  emit({ event: "failure", message: String(error instanceof Error ? error.stack : error) });
  process.exit(1);
}
