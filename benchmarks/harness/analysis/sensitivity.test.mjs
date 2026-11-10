import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePair,compareTables} from './sensitivity.mjs';

const row=(pc,estimate,error=0)=>({pc,context:'0x1000',flags:'0x83',cflags:'0x0',tier:'compiled',privilege:'user',
  samplesEstimate:estimate,samplesError:error,samplesLowerBound:estimate-error});
const profile=(pcs=[],edges=[])=>({pcs,edges,counters:{pcSamples:pcs.reduce((n,row)=>n+row.samplesEstimate,0),
  edgeSamples:edges.reduce((n,row)=>n+row.samplesEstimate,0)}});
function pair() {
  const capture={report:{mode:'profile-on',snapshotMode:'capture',samplePeriod:257,manifest:{app:'same',runtime:'same'},
    browser:'same',host:{platform:'test',arch:'test',release:'test',logicalCPUs:1,totalMemoryBytes:100},
    snapshot:{sha256:'snapshot',bytes:123,mtimeNs:'1000'},inputHashes:{'benchmarks/harness/m1/protocol.mjs':'same'},servedHashes:{}},
    artifacts:[{kind:'raw-report',sha256:'capture'}]};
  const restore=structuredClone(capture);Object.assign(restore.report,{snapshotMode:'restore',samplePeriod:263,captureReport:{sha256:'capture'}});
  return [capture,restore];
}

test('only a matching shared-capture restore with a different period is accepted',()=>{
  assert.equal(validatePair(...pair()),true);
  const corruptions=[r=>r.mode='profile-off',r=>r.snapshotMode='capture',r=>r.samplePeriod=257,
    r=>r.manifest.runtime='changed',r=>r.browser='changed',r=>r.host.arch='changed',
    r=>r.snapshot.sha256='changed',r=>r.snapshot.mtimeNs='changed',r=>r.captureReport.sha256='another-capture',
    r=>r.inputHashes['benchmarks/harness/m1/protocol.mjs']='changed'];
  for(const corrupt of corruptions){const [c,r]=pair();corrupt(r.report);assert.throws(()=>validatePair(c,r));}
});

test('code-inspection flags or per-phase payloads reject either comparison side',()=>{
  for(const index of [0,1])for(const mutate of [r=>r.captureCode=true,r=>r.browserResult={captureCode:true},
    r=>r.browserResult={warmup:{codeCapture:{}}},r=>r.browserResult={results:[{codeCapture:{}}]}]){
    const reports=pair();mutate(reports[index].report);
    assert.throws(()=>validatePair(...reports),/Code-inspection runs cannot enter/);
  }
  const reports=pair();for(const run of reports){run.report.captureCode=false;run.report.browserResult={captureCode:false};}
  assert.equal(validatePair(...reports),true);
});

test('each phase normalizes represented-key bounds against its own sample stream',()=>{
  const a=profile([row('0x10',80,10),row('0x20',20)]),b=profile([row('0x10',20,5),row('0x20',30)]);
  const [first]=compareTables(a,b,'pcs');
  assert.equal(first.capture.shareLower,.7);assert.equal(first.capture.shareUpper,.8);
  assert.equal(first.restore.shareLower,.3);assert.equal(first.restore.shareUpper,.4);
  assert.equal(first.capture.samplesError,10);assert.equal(first.restore.sampleDenominator,50);
});

test('missing and evicted keys remain unknown and an empty table is valid',()=>{
  const a=profile([row('0x10',100)]),b=profile([row('0x20',50)]);
  const rows=compareTables(a,b,'pcs');
  assert.equal(rows.length,2);assert.equal(rows[0].restore.status,'absent-from-bounded-table');
  assert.equal(rows[0].restore.shareUpper,null);assert.equal(rows[1].capture.shareLower,null);
  assert.deepEqual(compareTables(profile(),profile(),'pcs'),[]);
});

test('selection sorts full tables and union lookups retain non-top represented keys',()=>{
  const a=profile([row('0x10',1),row('0x20',99)]),b=profile([row('0x10',99),row('0x20',1)]);
  const rows=compareTables(a,b,'pcs',1);
  assert.deepEqual(rows.map(row=>row.key.pc),['0x20','0x10']);
  assert.equal(rows[0].restore.status,'represented');assert.equal(rows[0].restore.samplesEstimate,1);
});

test('context and tier are retained as distinct keys',()=>{
  const base=row('0x10',30),context={...base,context:'0x2000'},tier={...base,tier:'interpreted'};
  assert.equal(compareTables(profile([base,context,tier]),profile(),'pcs').length,3);
});

test('edge identity includes both endpoints and uses the edge denominator',()=>{
  const from=row('0x10',10),to=row('0x20',10);
  const a=profile([from,to],[{from,to,samplesEstimate:5,samplesError:1,samplesLowerBound:4}]);
  const [edge]=compareTables(a,profile(),'edges');
  assert.equal(edge.key.from.pc,'0x10');assert.equal(edge.key.to.pc,'0x20');
  assert.equal(edge.capture.shareLower,.8);assert.equal(edge.capture.sampleDenominator,5);
});

test('large counts remain exact strings while shares are explicitly approximate',()=>{
  const a=profile();a.pcs=[{...row('0x10',1),samplesEstimate:'9007199254740993',samplesError:0,samplesLowerBound:'9007199254740993'}];
  a.counters.pcSamples='9007199254740993';
  const [r]=compareTables(a,profile(),'pcs');
  assert.equal(r.capture.samplesEstimate,'9007199254740993');assert.equal(r.capture.sampleDenominator,'9007199254740993');
  assert.equal(r.capture.shareLower,1);
});

test('corrupt represented bounds and unsafe integer counts are rejected',()=>{
  for(const mutate of [p=>p.counters.pcSamples=0,p=>p.counters.pcSamples=9,
    p=>p.pcs[0].samplesLowerBound=11,p=>p.pcs[0].samplesEstimate=Number.MAX_SAFE_INTEGER+1]){
    const p=profile([row('0x10',10)]);mutate(p);assert.throws(()=>compareTables(p,profile(),'pcs'));
  }
});
