"""Independent prospective deadline amendment checks; no JS imports/execution."""
from pathlib import Path
import datetime as dt
RULE=dict(revision='passive-fifo-finite-deadline-v2',allowedTimeoutMs=[600000,1800000],hostGraceMs=20000,
 scope='Only requested future exploratory repetitions02/03. Same finite-v1 measurement; failed set01 remains permanently invalid. No confirmation or causal load claim.')
FIELDS=['packages','protocol','guestProtocol','horizonRule','bootstrapRule','parameters','orders','warmupOrders','planningRule','primary','secondary','service','primaryUpperRatio','secondaryUpperRatio','readyUpperRatio','memoryUpperRatio','serviceUpperRatio','driftRatioLimit','runtimeArtifactByteRatio','generatedCodeByteRatio','confidence','bootstrapDraws','bootstrapSeed','hostCondition']
def stamp(x):return dt.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp()
def validate(review,plan,same,require,campaign=None):
 same(plan['orchestration'],RULE['revision'],'deadline orchestration');same(plan['executionPolicyRule'],RULE,'deadline rule');same(plan['kind'],'exploration','no confirmation under deadline amendment');same(plan['pairs'],4,'four-pair repetition')
 p=plan['executionPolicy'];same(set(p),{'schema','revision','timeoutMs','hostGraceMs','repetition','planPath','amendment'},'policy fields')
 same(p['schema'],1,'policy schema');same(p['revision'],RULE['revision'],'policy revision');require(type(p['timeoutMs']) is int and p['timeoutMs'] in RULE['allowedTimeoutMs'],'bounded declared deadline');same(p['hostGraceMs'],20000,'outer grace');require(type(p['repetition']) is int and p['repetition'] in (2,3),'only future repetitions')
 def bound(item):
  path=review.path(item['path']);review.hash(path,dict(sha256=item['sha256']));return review.read(path)
 a=bound(p['amendment']);same(a['schema'],1,'amendment schema');same(a['kind'],'passive-fifo-finite-deadline-amendment','amendment kind');same(a['status'],'prospective-declared','amendment declaration');require(a['decision']['source'] in ('explicit-user-answer','assistant-default-after-unanswered-optional-clarification'),'deadline decision source');same(a['decision']['explicitUserAnswer'],a['decision']['source']=='explicit-user-answer','no invented user answer');same(a['decision']['timeoutMs'],a['timeoutMs'],'declared scheduling choice');same(a['protocol'],'defuss-passive-fifo-finite-v1','unchanged measurement protocol');same(a['timeoutMs'],p['timeoutMs'],'amended timeout');same(a['hostGraceMs'],20000,'amended grace');same(a['reporting'],'all-retained-descriptive-only','exploratory reporting');require(stamp(a['createdUtc'])<=stamp(plan['createdUtc']),'amendment predates plan')
 original=bound(a['originalPlan']);declaration=bound(a['repetitionsDeclaration']);same(declaration['originalPlan'],a['originalPlan'],'original plan declaration');same(declaration['protocol'],a['protocol'],'declaration protocol');same([r['number'] for r in declaration['repetitions']],[1,2,3],'three declared sets')
 same(original['kind'],'exploration','original exploration');same(original['protocol'],a['protocol'],'original protocol');same(original['pairs'],4,'original four-pair set');require(all(s['timeoutMs']==600000 for s in original['steps']),'original deadline')
 preserved=a['preservedCampaign'];same(preserved['path'],declaration['repetitions'][0]['campaign'],'original failed set');frozen=bound(dict(path=preserved['path']+'/frozen.json',sha256=preserved['frozenSha256']));halt=bound(dict(path=preserved['path']+'/invalid-completed-observation.json',sha256=preserved['haltSha256']))
 same(frozen['planSha256'],a['originalPlan']['sha256'],'preserved original plan hash');same(frozen['plan'],original,'preserved original plan');same(halt['schema'],1,'permanent halt schema');require(halt['attempt'].startswith(preserved['path']+'/attempts/') and 'permanently invalid' in halt['reason'],'preserved permanent invalidation')
 require(stamp(a['createdUtc'])>=max(stamp(original['createdUtc']),stamp(declaration['createdUtc']),stamp(halt['utc'])),'amendment cannot predate original evidence')
 same([x['number'] for x in a['repetitions']],[2,3],'two future amended repetitions');same([x['number'] for x in a['retainedPlans']],[2,3],'old future plans retained')
 new_paths=[x[k] for x in a['repetitions'] for k in ('plan','campaign','analysis','review')];old_paths={x[k] for x in declaration['repetitions'] for k in ('plan','campaign','analysis','review')};require(len(set(new_paths))==8 and not set(new_paths)&old_paths,'all new output paths distinct from old evidence')
 for path in new_paths:same(str(review.path(path).resolve().relative_to(review.root)),path,'canonical new output path')
 for old in declaration['repetitions'][1:]:require(not review.path(old['campaign']).exists(),'old future campaign exists; no extra replacement')
 for ref in a['retainedPlans']:
  same(ref['path'],next(x for x in declaration['repetitions'] if x['number']==ref['number'])['plan'],'old future plan path');retained=bound(ref);same(retained['kind'],'exploration','retained exploration');same(retained['pairs'],4,'retained pair count');same(retained['packages'],original['packages'],'retained packages');require(all(s['timeoutMs']==600000 for s in retained['steps']),'retained old deadline')
 declared=next(x for x in a['repetitions'] if x['number']==p['repetition']);same(p['planPath'],declared['plan'],'declared future plan path')
 if campaign is not None:same(str(Path(campaign).relative_to(review.root)),declared['campaign'],'declared future campaign path')
 refs=[p['amendment']['path'],a['originalPlan']['path'],a['repetitionsDeclaration']['path'],preserved['path']+'/frozen.json',preserved['path']+'/invalid-completed-observation.json',*[x['path'] for x in a['retainedPlans']]]
 require(all(x in plan['inputs'] for x in refs),'all exact amendment references frozen');same(plan['inputs'][:len(original['inputs'])],original['inputs'],'original input sequence')
 for key in FIELDS:same(plan[key],original[key],'unchanged measurement '+key)
 same(plan['steps'],[{**s,'timeoutMs':p['timeoutMs']} for s in original['steps']],'only deadline changes steps')
 return dict(amendment=a,declaration=declaration,original=original)
