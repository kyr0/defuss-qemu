export const fixtureDefinitions = {
  rnds2: {modes:7, checksPerMode:4096},
  pmaxub: {modes:20, checksPerMode:4096},
  setup: {modes:5, checksPerMode:4096},
  pshufb: {modes:17, checksPerMode:2048},
};
export const counterDefinitions = {
  rnds2: ['_defuss_inline_rnds2_counts',3],
  pmaxub: ['_defuss_inline_pmaxub_counts',4],
  setup: ['_defuss_inline_setup_counts',5],
};
export function checkFixtureCounters(fixture, family, mode, delta, cold) {
  const check=(ok,why)=>{if(!ok)throw Error(`${fixture} mode ${mode}: ${why}`);};
  check(delta.length===counterDefinitions[family][1] &&
    delta.every(n=>Number.isSafeInteger(n)&&n>=0),'invalid counter delta');
  if(family==='rnds2') {
    check(fixture==='rnds2','wrong counter family');
    const [native,inline,fallback]=delta;
    check(native+inline===4096 && fallback===0,'wrong operation accounting');
    check(cold?native===4096&&inline===0:native>0&&inline>1000,'missing intended tier coverage');
  } else if(family==='pmaxub') {
    check(fixture==='pmaxub','wrong counter family');
    const legacy=[0,1,12].includes(mode),vex=[2,3,4,5,6,13,14].includes(mode);
    if(!legacy&&!vex){check(delta.every(n=>n===0),'changed MMX/YMM path');return;}
    const offset=legacy?0:2;
    check(delta.every((n,i)=>i===offset||i===offset+1||n===0),'unexpected encoding family');
    check(delta[offset]+delta[offset+1]===4096,'wrong operation accounting');
    check(cold?delta[offset]===4096&&delta[offset+1]===0:
      delta[offset]>0&&delta[offset+1]>1000,'missing intended tier coverage');
  } else if(family==='setup') {
    check(fixture==='setup'||fixture==='pshufb','wrong fixture for setup counters');
    if(cold){
      // The reused PSHUFB fixture's memcmp driver can compile unrelated
      // equality/mask code after many modes. Its PSHUFB sites must stay cold.
      check((fixture==='pshufb'?delta.slice(0,2):delta).every(n=>n===0),
        'selected compiled operations during fallback');return;
    }
    const index=fixture==='setup'?mode:((mode>=7&&mode<=11)||mode>=15?1:0);
    check(delta[index]>(fixture==='setup'?1000:255),'missing selected compiled family');
    // Counts prove the selected family, not exact first-control-byte bins.
    // Common min/equality/mask can also occur in library/console code.
  }
}
