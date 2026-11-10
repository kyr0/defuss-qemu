// VERIFIED: reuse the frozen input verifier so a changed diagnostic driver
// cannot inherit a passing capture. This check does not launch a benchmark.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {sha} from '../../benchmarks/harness/m2-msg1-timing/identity.mjs';
import {verifyRetainedInputs as verifyInputs} from './evidence-inputs.mjs';
const root=process.cwd(),read=async path=>JSON.parse(await readFile(path));
const captures=[
 ['artifacts/engine-cpu-calibration-02','artifacts/engine-cpu-calibration-execution-02'],
 ['artifacts/engine-cpu-rnds2-01','artifacts/engine-cpu-rnds2-execution-01'],
 ['artifacts/engine-pressure-exposure-01','artifacts/engine-pressure-execution-01'],
];
for(const [capture,execution]of captures){
 const report=await read(capture+'/report.json');assert.equal(report.status,'passed');assert.equal(report.timingEligible,false);
 await verifyInputs(root,report.inputs);
 assert.equal((await read(execution+'/execution.json')).returncode,0);
 assert.equal((await read(execution+'/browser-cleanup.json')).status,'passed');
}
const wait=await read('artifacts/engine-cpu-wait-calibration-01/report.json');
assert.equal(wait.status,'passed');assert.equal(wait.timingEligible,false);assert.equal(wait.result.value,2);
// The one-off wait probe was copied into its artifact before execution. Keep
// the durable copy as the evidence dependency, not its scratch working file.
await verifyInputs(root,Object.fromEntries(Object.entries(wait.inputs).map(([path,id])=>['artifacts/engine-cpu-wait-calibration-01/'+basename(path),id])));
assert.equal((await read('artifacts/engine-cpu-wait-calibration-01/browser-cleanup.json')).status,'passed');
const findings=await read('artifacts/engine-cpu-findings-01/report.json');assert.equal(findings.status,'passed');
await verifyInputs(root,findings.inputs);assert.equal(sha(await readFile('experiments/engine-cpu-profile/symbolize.py')),findings.analysisScript);
const pressure=await read('artifacts/engine-pressure-exposure-01/analysis.json');assert.equal(pressure.status,'passed');await verifyInputs(root,pressure.inputs);
const timing=await read('artifacts/m2-msg1-timing-analysis-02/analysis.json');assert.equal(timing.status,'passed');await verifyInputs(root,timing.inputs);
const plan=await read('artifacts/m2-msg1-timing-plan-02/plan.json');await verifyInputs(root,plan.inputs);
console.log(new Date().toISOString()+' INFO retained-evidence status=passed captures=3 waitCalibration=1 timingRuns=18');
