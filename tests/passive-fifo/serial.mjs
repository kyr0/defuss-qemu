import assert from 'node:assert/strict';
export function parseSerialRecords(serial){
 assert.equal(typeof serial,'string');assert.ok(Buffer.byteLength(serial)<=16*1048576);
 const result={markers:[],results:[],order:[]},seen=new Set();
 for(const raw of serial.split('\n')){
  const line=raw.replace(/\r/g,'');if(!/^(REGION_|PRESSURE_)/.test(line))continue;
  if(line.startsWith('REGION_FAIL:')||line.startsWith('PRESSURE_FAIL:'))throw Error('Raw guest failure');
  const gate=line.match(/^REGION_GATE:(-?\d+)$/);
  if(gate){result.markers.push({fixturePhase:'main',stage:Number(gate[1])});result.order.push('main-gate');continue;}
  const match=line.match(/^(REGION_LAYOUT|REGION_START|REGION_SMC_RANGE|REGION_RESULT|REGION_INTERRUPTS|REGION_PASS|PRESSURE_LAYOUT|PRESSURE_GATE|PRESSURE_PASS):(.*)$/);
  if(!match)throw Error('Unknown/malformed retained guest record');
  const [,key,body]=match,value=JSON.parse(body);result.order.push(key);
  if(key==='REGION_RESULT'){result.results.push(value);continue;}
  if(key==='PRESSURE_GATE'){result.markers.push({fixturePhase:'pressure',...value});continue;}
  if(seen.has(key))throw Error('Duplicate raw guest record: '+key);seen.add(key);result[key]=value;
 }
 return result;
}
export function validateSerial(report,serial){
 const raw=parseSerialRecords(serial);assert.deepEqual(raw.markers,report.markers);assert.deepEqual(raw.results,report.results);
 const mainSequence=['REGION_LAYOUT','REGION_START','main-gate','REGION_RESULT','main-gate','REGION_RESULT','main-gate','REGION_RESULT','main-gate','REGION_RESULT','main-gate','main-gate','main-gate','main-gate','REGION_RESULT','main-gate','REGION_SMC_RANGE','main-gate','main-gate','main-gate','REGION_RESULT','main-gate','main-gate','REGION_INTERRUPTS','REGION_RESULT','main-gate','main-gate','main-gate','REGION_PASS'];
 const pressureSequence=['PRESSURE_LAYOUT',...raw.markers.filter(m=>m.fixturePhase==='pressure').map(()=>'PRESSURE_GATE'),'PRESSURE_PASS'];
 assert.deepEqual(raw.order,report.fixture==='main'?mainSequence:report.fixture==='pressure'?pressureSequence:[...pressureSequence,...mainSequence],'Raw record interleaving differs');
 if(report.fixture!=='main'){
  assert.deepEqual(raw.PRESSURE_LAYOUT,report.pressureLayout??report.layout);assert.deepEqual(raw.PRESSURE_PASS,report.pressureValidation??report.validation);
  assert.ok(raw.order.indexOf('PRESSURE_LAYOUT')<raw.order.indexOf('PRESSURE_GATE'));assert.ok(raw.order.lastIndexOf('PRESSURE_GATE')<raw.order.indexOf('PRESSURE_PASS'));
 }else assert.equal(raw.PRESSURE_LAYOUT,undefined);
 if(report.fixture!=='pressure'){
  assert.equal(raw.REGION_START,1);assert.ok(raw.order.indexOf('REGION_LAYOUT')<raw.order.indexOf('REGION_START'));assert.ok(raw.order.indexOf('REGION_START')<raw.order.indexOf('main-gate'));
  assert.deepEqual(raw.REGION_LAYOUT,report.layout);assert.deepEqual(raw.REGION_SMC_RANGE,report.smc);assert.deepEqual(raw.REGION_INTERRUPTS,report.interrupts);assert.deepEqual(raw.REGION_PASS,report.validation);
  assert.ok(raw.order.indexOf('REGION_LAYOUT')<raw.order.indexOf('main-gate'));assert.ok(raw.order.lastIndexOf('main-gate')<raw.order.indexOf('REGION_PASS'));
  if(report.fixture==='combined')assert.ok(raw.order.indexOf('PRESSURE_PASS')<raw.order.indexOf('REGION_LAYOUT'));
 }else assert.equal(raw.REGION_LAYOUT,undefined);
 return {status:'passed',records:raw.order.length,scope:'Exact parsed retained console records match report arrays/layouts/results, with unique completion/layout/interrupt records.'};
}
