import assert from 'node:assert/strict';
import {checkExposure as checkModeExposure} from './fixture-check.mjs';

// This contract is bound to the archived source compiled into the ISA guest.
// Modes 0..5 execute one instruction 4096 times. Mode 6 additionally warms
// fault_operation's single instruction 4096 times; its final fault occurs in
// the operand load before either the helper or inline body can execute.
export const fixtureSourceSha256='504497a4a040dad223d6c302563b2131e9458ec71dbefa685d3feb2b9902a636';
export const expectedInstructionCounts=Object.freeze(['4096','4096','4096','4096','4096','4096','8192']);

export function checkExposure(delta,{enabled,cold,mode}){
  assert.ok(Number.isInteger(mode)&&mode>=0&&mode<expectedInstructionCounts.length,'Unknown MSG2 fixture mode');
  checkModeExposure(delta,{enabled,cold});
  const [original,inline,fallback]=delta.map(BigInt);
  const expected=BigInt(expectedInstructionCounts[mode]);
  // Compiled fallback is already included in original; do not add it twice.
  assert.equal(original+inline,expected,'Unexpected MSG2 execution count; missing fixture work or additional executions');
  return {contract:'exact-fixture-v1',mode,expectedInstructions:String(expected),observedInstructions:String(original+inline),
    interpreted:String(original-fallback),compiledInline:String(inline),compiledFallback:String(fallback)};
}
