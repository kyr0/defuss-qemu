import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {createReference} from './reference.mjs';
import {validateReference} from './validate.mjs';
import {runBenchmarks} from './benchmark.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sourceFiles=['kernels.c','build.py','reference.mjs','oracle.mjs','validate.mjs','benchmark.mjs','node-runner.mjs','check.mjs','run.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function main({measure=false}={}) {
  const [buildArgument,label]=process.argv.slice(2);
  assert.ok(buildArgument&&label,'Usage: node benchmarks/wasm-reference/'+(measure?'run':'check')+'.mjs BUILD_DIRECTORY FRESH_LABEL');
  assert.match(label,/^[a-z0-9][a-z0-9-]*$/,'Use a simple fresh label');
  const build=resolve(root,buildArgument),output=resolve(root,'artifacts/wasm-reference',label);
  assert.ok(build.startsWith(root+'/'),'Build directory must be inside defuss-vm');
  const buildReport=JSON.parse(await readFile(resolve(build,'build-report.json'),'utf8'));
  assert.equal(buildReport.status,'passed');
  const wasm=await readFile(resolve(build,'references.wasm'));
  assert.equal(sha(wasm),buildReport.wasmSha256,'Built WASM identity mismatch');
  assert.equal(sha(await readFile(new URL('./kernels.c',import.meta.url))),buildReport.sourceSha256,'Source changed since this build');
  await mkdir(dirname(output),{recursive:true});await mkdir(output);
  const report={schema:1,status:'failed',scope:'Direct standalone component correctness'+(measure?' and exploratory reference timing':''),
    build:{directory:build,wasmSha256:sha(wasm),wasmBytes:wasm.length,buildReportSha256:sha(await readFile(resolve(build,'build-report.json')))},
    host:{node:process.version,v8:process.versions.v8,platform:process.platform,architecture:process.arch,release:os.release(),cpu:os.cpus()[0]?.model},
    source:{}};
  try {
    for(const file of sourceFiles)report.source[file]=sha(await readFile(new URL(file,import.meta.url)));
    const api=await createReference(wasm);report.runtime=api.metadata;
    report.validation=await validateReference(api,{hashOracle:bytes=>createHash('sha256').update(bytes).digest(),hashOracleName:'Node crypto SHA-256 (independent complete-hash oracle)'});
    const original=JSON.parse(await readFile(resolve(root,'benchmarks/expected.json'),'utf8'));
    assert.equal(report.validation.originalSha256,original.sha256,'Original benchmark SHA identity');
    assert.equal(api.integerChecked(123,250000,1664525,1013904223),original.integer,'Original benchmark integer result');
    if(measure){
      report.benchmark=await runBenchmarks(api,{samples:Number(process.env.REFERENCE_SAMPLES||7),warmup:Number(process.env.REFERENCE_WARMUP||5),callsPerSample:Number(process.env.REFERENCE_CALLS||10)});
      assert.equal(report.benchmark.expected.integer,original.integer);
      assert.equal(report.benchmark.expected.sha256,original.sha256);
    }
    report.status='passed';
  } catch(error){report.failure=String(error.stack||error);process.exitCode=1;}
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,report:resolve(output,'report.json'),checks:report.validation&&{
    integer:report.validation.integerCases,compression:report.validation.compressionCases,digest:report.validation.digestCases,
    streamingPartitions:report.validation.streamingPartitions,rejections:report.validation.rejectedCases},failure:report.failure}));
}
