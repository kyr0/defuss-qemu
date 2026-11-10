import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecovery,validateExposure,validateMutatingSMC} from './guest.mjs';

function snapshot({stale=1,invalid=0,selected=100,slots=[100,0,0,0]}={}){
 return {counters:{staleInstanceMisses:stale,invalidRedispatches:invalid,selectedEntries:selected},
  watches:slots.map(selectedEntries=>({selectedEntries}))};
}
test('invalid-owner immediate recovery and recompiled replacement are separate requirements',()=>{
 const injection={action:'invalid-descriptor',after:snapshot()};
 const immediate=snapshot({invalid:1});
 assert.doesNotThrow(()=>validateRecovery(immediate,injection,false));
 assert.throws(()=>validateRecovery(immediate,injection,true),/after rewarm/);
 assert.doesNotThrow(()=>validateRecovery(snapshot({invalid:1,slots:[101,0,0,0]}),injection,true));
});
test('rewarm cannot conceal repeated redispatch or an unexpected stale miss',()=>{
 const injection={action:'invalid-descriptor',after:snapshot()};
 assert.throws(()=>validateRecovery(snapshot({invalid:2,slots:[101,0,0,0]}),injection,true),/exactly once/);
 assert.throws(()=>validateRecovery(snapshot({invalid:1,stale:2,slots:[101,0,0,0]}),injection,true),/other recovery/);
});
test('stale-instance recovery requires exactly one miss plus selected execution',()=>{
 const injection={action:'stale-instance',after:snapshot({stale:0})};
 assert.throws(()=>validateRecovery(snapshot(),injection,true),/after rewarm/);
 assert.doesNotThrow(()=>validateRecovery(snapshot({slots:[101,0,0,0]}),injection,true));
});
test('one selected SMC range cannot satisfy the other range',()=>{
 assert.throws(()=>validateExposure(snapshot({slots:[4000,0,0,0]}),[0,1],true,2),/slot 1/);
 assert.throws(()=>validateExposure(snapshot({slots:[0,4000,0,0]}),[0,1],true,2),/slot 0/);
 assert.doesNotThrow(()=>validateExposure(snapshot({slots:[1,1,0,0]}),[0,1],true,2));
});
test('fault load exposure cannot satisfy protected-store exposure',()=>{
 assert.throws(()=>validateExposure(snapshot({slots:[0,256,0,0]}),[2],true,1),/slot 2/);
 assert.doesNotThrow(()=>validateExposure(snapshot({slots:[0,0,128,0]}),[2],true,1));
 assert.throws(()=>validateExposure(snapshot(),[],false,-1),/Disabled region/);
});
test('isolated active-SMC call requires exactly one original entry and invalidation',()=>{
 const before=snapshot();before.counters.invalidations=20;
 const after=snapshot({slots:[0,1,0,0]});after.counters.invalidations=21;after.watches[1].lastSelectedPC='0x700080';
 assert.doesNotThrow(()=>validateMutatingSMC(after,before,0x700080n));
 after.watches[1].selectedEntries=2;assert.throws(()=>validateMutatingSMC(after,before,0x700080n),/exactly once/);
 after.watches[1].selectedEntries=1;after.watches[1].lastSelectedPC='0x700083';assert.throws(()=>validateMutatingSMC(after,before,0x700080n),/original entry/);
 after.watches[1].lastSelectedPC='0x700080';after.counters.invalidations=20;assert.throws(()=>validateMutatingSMC(after,before,0x700080n),/invalidation/);
});
