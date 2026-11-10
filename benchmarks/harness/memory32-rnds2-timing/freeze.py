#!/usr/bin/env python3
"""Freeze a distinct memory32-address experiment after correctness acceptance."""
import ast,datetime,hashlib,importlib.util,json,math,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
OUT=ROOT/'artifacts/memory32-rnds2-timing-plan-01'
sys.path.insert(0,str(ROOT/'experiments/rnds2-lanes'))
from prepare import inventory

def ident(p):
    with p.open('rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def save(p,obj):
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    assert not OUT.exists()
    sources=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {sources}from'./benchmarks/harness/memory32-rnds2-timing/identity.mjs';console.log(JSON.stringify(sources))"],cwd=ROOT,text=True))
    basefp,basefiles=inventory(ROOT/'engine/qemu')
    assert basefp=='2aa3673909fa05c2c2407776b5825be674e80850168d8459323fa6451bab3c7a'
    build_paths={'control':'artifacts/rnds2-setup-control-build-01','candidate':'artifacts/memory32-rnds2-build-02','diagnostic':'artifacts/memory32-rnds2-check-build-01'}
    builds={k:json.loads((ROOT/p/'build-report.json').read_text())for k,p in build_paths.items()}
    current=builds['candidate'];control=builds['control'];diagnostic=builds['diagnostic']
    for b in builds.values():assert b['status']=='passed' and b['sdk']==control['sdk']and b['emccVersion']==control['emccVersion']
    assert current['sourceFingerprint']==control['sourceFingerprint']==basefp
    # Exactly one new configure option; compile command and all other flags match.
    commands=[[s.replace(control['source'],current['source'])for s in row]for row in control['commands']]
    commands[0].insert(commands[0].index('--cpu=wasm64')+1,'--wasm64-32bit-address-limit')
    assert current['commands']==commands
    assert diagnostic['commands']==[[s.replace(current['source'],diagnostic['source'])for s in row]for row in current['commands']]
    checkroot=ROOT/'artifacts/memory32-rnds2-check-source-01';overlay=json.loads((checkroot/'overlay.json').read_text())
    fp,files=inventory(checkroot/'source');assert fp==overlay['sourceFingerprint']==diagnostic['sourceFingerprint']
    assert overlay['baseFingerprint']==basefp and files==json.loads((checkroot/'inventory.json').read_text())['files']
    for p,id in overlay['inputs'].items():assert ident(ROOT/p)==id
    runtimefiles={k:[p+'/'+f for f in builds[k]['artifacts']]for k,p in build_paths.items()}
    for k,p in build_paths.items():
        for f,id in builds[k]['artifacts'].items():assert ident(ROOT/p/f)==id
    baseline=json.loads((ROOT/'manifests/runtime-baseline.json').read_text())
    for p,id in baseline['runtimes']['x86_64']['files'].items():assert ident(ROOT/p)==id
    runtimefiles['original']=[str(p.relative_to(ROOT))for p in sorted((ROOT/'runtime').rglob('*'))if p.is_file()and(p.suffix=='.mjs'or p.parent==ROOT/'runtime/x86_64')]
    inspection_path='artifacts/memory32-rnds2-binary-inspection-01/report.json'
    inspection=json.loads((ROOT/inspection_path).read_text());assert inspection['status']=='passed'
    for v in inspection['runtimes'].values():assert ident(ROOT/v['path'])=={k:v[k]for k in ['sha256','bytes']}
    script="import {readFile}from'node:fs/promises';let m=await WebAssembly.compile(await readFile(process.argv[1]));console.log(JSON.stringify(WebAssembly.Module.exports(m).map(x=>x.name)));"
    exports=json.loads(subprocess.check_output(['node','--input-type=module','-e',script,str(ROOT/build_paths['candidate']/'runtime/x86_64/qemu-system-x86_64.wasm')],text=True))
    assert not any(n.startswith(('defuss_m1_','defuss_m3','defuss_inline_rnds2_'))for n in exports)
    checks=[];checkinputs=set()
    for mode in ['native','hot','cold','pshufb','production','rnds2']:
        name=f'artifacts/memory32-rnds2-validation-{mode}-01/report.json';r=json.loads((ROOT/name).read_text());assert r['status']=='passed'
        for p,id in r['inputs'].items():assert ident(ROOT/p)==id;checkinputs.add(p)
        checks.extend([name,f'artifacts/memory32-rnds2-validation-execution-{mode}-01/browser-cleanup.json'])
        assert json.loads((ROOT/checks[-1]).read_text())['status']=='passed'
    for p in sources:
        if p.endswith('.py'):ast.parse((ROOT/p).read_text())
        elif p.startswith('benchmarks/harness/memory32-rnds2-timing/')and p.endswith('.mjs'):subprocess.run(['node','--check',p],check=True,cwd=ROOT)
    test=subprocess.run(['node','--test',str(HERE/'test.mjs')],check=True,capture_output=True,text=True,cwd=ROOT)
    spec=importlib.util.spec_from_file_location('analysis',HERE/'analyze.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    assert mod.estimate([1]*6)['interval95']==[1,1]
    a=mod.estimate([.8,.9,1,1.1,1.2,1.3]);b=mod.estimate([1/x for x in [.8,.9,1,1.1,1.2,1.3]])
    assert math.isclose(a['geometricMean']*b['geometricMean'],1,rel_tol=1e-12)
    assert all(math.isclose(x*y,1,rel_tol=1e-12)for x,y in zip(a['interval95'],reversed(b['interval95'])))
    sdk=json.loads((ROOT/'artifacts/memory32-rnds2-sdk-setting-01/report.json').read_text());assert sdk['status']=='passed' and sdk['emcc'].strip()==current['emccVersion']
    packaging=json.loads((ROOT/'artifacts/memory32-rnds2-packaging-tests-01/report.json').read_text());assert packaging['status']=='passed'
    for p,id in packaging['inputs'].items():assert ident(ROOT/p)==id
    OUT.mkdir();(OUT/'host-tests.log').write_text(test.stdout+test.stderr)
    save(OUT/'source-inventory.json',{'sourceFingerprint':basefp,'files':basefiles})
    save(OUT/'validation.json',{'status':'passed','sourceFingerprint':basefp,'actualWasmExports':exports,'nativeChecks':checks,'binaryInspection':inspection_path,'buildDifference':'only --wasm64-32bit-address-limit'})
    package='artifacts/m2-msg1-exposure-off-package-01';manifest=json.loads((ROOT/package/'app.json').read_text())
    guestfiles=[package+'/app.json']+[package+'/'+manifest['generation']+'/'+p for p in ['app.mjs','kernel','initramfs.cpio.gz','rom/bios-256k.bin','rom/kvmvapic.bin','rom/linuxboot_dma.bin']]
    extra=[p+'/build-report.json'for p in build_paths.values()]+['artifacts/memory32-rnds2-check-source-01/'+p for p in ['overlay.json','inventory.json']]
    extra+=['manifests/runtime-baseline.json','artifacts/m3b-bun-code-attribution-off-01/progress.jsonl','scripts/build.py','scripts/sdk.py','scripts/runtime_dependencies.py',inspection_path,'artifacts/rnds2-lanes-v2-timing-analysis-01/analysis.json','artifacts/memory32-rnds2-packaging-tests-01/report.json']
    extra+=[str((OUT/p).relative_to(ROOT))for p in ['source-inventory.json','validation.json','host-tests.log']]+checks
    for p,id in current['inputs'].items():assert ident(ROOT/p)==id;extra.append(p)
    for folder in ['memory32-rnds2-emitter-01','memory32-rnds2-node-codegen-01','memory32-rnds2-sdk-setting-01']:
        for p in (ROOT/'artifacts'/folder).iterdir():
            if p.is_file()and p.suffix in ['.json','.txt','.log','.c','.body','.wasm','.mjs']:extra.append(str(p.relative_to(ROOT)))
    assert json.loads((ROOT/'artifacts/memory32-rnds2-emitter-01/tests.json').read_text())['checks']==40960
    for p,id in json.loads((ROOT/'artifacts/memory32-rnds2-emitter-01/inputs.json').read_text()).items():assert ident(ROOT/p)==id;extra.append(p)
    cg=json.loads((ROOT/'artifacts/memory32-rnds2-node-codegen-01/report.json').read_text());assert cg['status']=='passed' and cg['timingEligible']is False
    for p,id in cg['inputs'].items():assert ident(ROOT/p)==id;extra.append(p)
    for name in ['emitter-test.mjs','capture-sdk.py','validate.py','validate-production.py','archive-runtimes.py']:extra.append('experiments/memory32-rnds2/'+name)
    inputs={p:ident(ROOT/p)for p in sorted(set(sources+sum(runtimefiles.values(),[])+guestfiles+extra)|checkinputs)}
    for p in sources:
        dest=OUT/'source'/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,dest)
    orders=[['original','control','candidate'],['control','candidate','original'],['candidate','original','control'],['original','candidate','control'],['candidate','control','original'],['control','original','candidate']]
    assert len({tuple(x)for x in orders})==6
    steps=[]
    for block,order in enumerate(orders,1):
        for arm in order:
            key=f'block-{block:02d}-{arm}';steps.append({'id':key,'block':block,'arm':arm,'capture':'artifacts/memory32-rnds2-timing-01/'+key,'execution':'artifacts/memory32-rnds2-timing-execution-'+key+'-01'})
    node=Path(shutil.which('node')).resolve();chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    host_tools={'node':{'path':str(node),**ident(node),'version':subprocess.check_output([str(node),'--version'],text=True).strip()},'chrome':{'path':str(chrome),**ident(chrome),'version':subprocess.check_output([str(chrome),'--version'],text=True).strip()}}
    runtimes={k:{'directory':p+'/runtime/x86_64','files':runtimefiles[k]}for k,p in build_paths.items()};runtimes['diagnostic']['timingEligible']=False
    runtimes['original']={'directory':'runtime/x86_64','files':runtimefiles['original']}
    save(OUT/'plan.json',{'schema':1,'status':'frozen','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'independent memory profile experiment','hostTools':host_tools,'runtimes':runtimes,'blocks':6,'timeoutMs':1800000,'snapshot':False,'inputs':inputs,'steps':steps,'statistics':{'primary':'horizon','unit':'independent cold launch paired within three-arm block','aggregation':'full horizon; workload median of three 100-call batches','interval':'paired log Student t marginal 95%, df=5','retainAll':True,'poolWithOtherStudies':False,'meaningfulImprovement':0.05,'improvementDecision':'upper95 < 1 versus both original and matched rebuild','fivePercentDecision':'upper95 < .95 versus both references','secondary':'descriptive only'},'promotionBudgets':{'otherWorkloadTimeRatio':1.05,'readyRatio':1.05,'wasmBytesRatio':1.01,'linearMemoryBytes':2147483648,'instanceLimit':12000,'peakProcessMemoryRatio':1.05,'guestServiceLatencyRatio':1.05,'untestedGates':['peak process memory','guest service/interrupt latency','held-out application','other supported platforms'],'automaticPromotion':False}})
    print(json.dumps({'status':'frozen','inputs':len(inputs),'steps':len(steps)}))
if __name__=='__main__':main()
