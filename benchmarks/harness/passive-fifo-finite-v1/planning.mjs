import assert from 'node:assert/strict';
export const planningRule=Object.freeze({method:'Conservative approximate Gaussian planning from four independent pilot paired log-ratios; not a power guarantee for the bootstrap decision',
 pilotPairs:4,power:0.80,sdUpperConfidence:0.90,sdChiSquareLowerQuantile:0.5843743741551835,sdDegreesOfFreedom:3,
 primaryTargetRatio:0.90,otherTargetRatio:1,minimumPairs:8,maximumPairs:32,roundTo:'next even number',
 formula:'s_design=s_pilot*sqrt(3/chi2(0.10,3)); N_endpoint=ceil(((z_bound+z_0.80)*s_design/log(limit/target))^2); N=max(8, all endpoints), rounded even. Never clamp to the maximum.'});
export function planConfirmation(endpoints,plan){
 const details={};let requiredPairs=planningRule.minimumPairs;
 for(const name of [plan.primary,...plan.secondary,'ready',...plan.service]){
  const values=endpoints[name].ratios;assert.equal(values.length,4);assert.ok(values.every(x=>Number.isFinite(x)&&x>0));
  const logs=values.map(Math.log),mean=logs.reduce((a,b)=>a+b,0)/4;
  const pilotSD=Math.sqrt(logs.reduce((a,b)=>a+(b-mean)**2,0)/3),designSD=pilotSD*Math.sqrt(3/planningRule.sdChiSquareLowerQuantile);
  const limit=name===plan.primary?plan.primaryUpperRatio:name==='ready'?plan.readyUpperRatio:plan.service.includes(name)?plan.serviceUpperRatio:plan.secondaryUpperRatio;
  const target=name===plan.primary?planningRule.primaryTargetRatio:1;
  const z=name===plan.primary||plan.service.includes(name)?2.5758293035489004:name==='ready'?2.3263478740408408:2.878161739095483;
  const n=Math.ceil(((z+0.8416212335729143)*designSD/Math.log(limit/target))**2);
  details[name]={pilotSD,designSD,target,limit,zBound:z,rawRequiredPairs:n};requiredPairs=Math.max(requiredPairs,n);
 }
 requiredPairs+=requiredPairs%2;
 return {rule:planningRule,endpoints:details,requiredPairs,feasible:requiredPairs<=planningRule.maximumPairs,
  action:requiredPairs<=planningRule.maximumPairs?'Freeze exactly the required number of wholly fresh confirmation pairs.':'No confirmation under this plan. Retain the pilot and declare a new expanded pilot/design or an explicit larger budget before collecting more data.'};
}
export function assessDrift(rows,ratioLimit=1.10){
 assert.equal(rows.length,8);assert.deepEqual(rows.map(r=>r.sample),[0,1,2,3,4,5,6,7]);
 const median=a=>{a=[...a].sort((a,b)=>a-b);return (a[1]+a[2])/2;};
 const earlyMedianMs=median(rows.slice(0,4).map(r=>r.hostMs)),lateMedianMs=median(rows.slice(4).map(r=>r.hostMs));
 assert.ok(earlyMedianMs>0&&lateMedianMs>0);const ratio=lateMedianMs/earlyMedianMs;
 return {earlyMedianMs,lateMedianMs,lateEarlyRatio:ratio,ratioLimit,withinBound:ratio>=1/ratioLimit&&ratio<=ratioLimit,
  scope:'Descriptive drift only; never an exclusion, retry or decision veto. All52 phases remain in the horizon and workload totals; no stationarity claim.'};
}
