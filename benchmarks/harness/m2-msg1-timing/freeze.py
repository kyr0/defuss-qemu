#!/usr/bin/env python3
"""Freeze same-binary MSG1 off/on timing after production ISA acceptance."""
import ast,datetime,hashlib,importlib.util,json,math,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
OUT=ROOT/'artifacts/m2-msg1-timing-plan-01'
sys.path.insert(0,str(ROOT/'experiments/rnds2-lanes'))
from prepare import inventory

def ident(p):
    with p.open('rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def save(p,obj):
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    assert not OUT.exists()
    sources=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {sources}from'./benchmarks/harness/m2-msg1-timing/identity.mjs';console.log(JSON.stringify(sources))"],cwd=ROOT,text=True))
    proof_path='artifacts/m2-msg1-performance-source-proof-01/report.json';proof=json.loads((ROOT/proof_path).read_text());assert proof['status']=='passed'
    for p,id in proof['checkedInputs'].items():assert ident(ROOT/p)==id,p
    inventory_path='artifacts/m2-msg1-performance-source-proof-01/inventories.json';assert ident(ROOT/inventory_path)==proof['inventory']
    inventories=json.loads((ROOT/inventory_path).read_text())
    assert inventory(ROOT/'engine/qemu')[0]==proof['baseFingerprint']
    for k,v in proof['sources'].items():
        fp,files=inventory(ROOT/v['source']);assert fp==v['sourceFingerprint'] and files==inventories[k]['files']
    current_path='artifacts/m2-msg1-performance-build-01';diagnostic_path='artifacts/m2-msg1-diagnostic-build-01';accepted_path='artifacts/rnds2-setup-control-build-01/build-report.json'
    current=json.loads((ROOT/current_path/'build-report.json').read_text());diagnostic=json.loads((ROOT/diagnostic_path/'build-report.json').read_text());accepted=json.loads((ROOT/accepted_path).read_text())
    for b in [current,diagnostic]:assert b['status']=='passed' and b['sdk']==accepted['sdk']and b['emccVersion']==accepted['emccVersion']
    assert current['sourceFingerprint']==proof['sources']['switch']['sourceFingerprint']
    assert diagnostic['sourceFingerprint']==proof['sources']['diagnostic']['sourceFingerprint']
    assert current['commands']==[[s.replace(accepted['source'],current['source'])for s in row]for row in accepted['commands']]
    assert diagnostic['commands'][0]==[s.replace(current['source'],diagnostic['source'])for s in current['commands'][0]]
    currentfiles=[current_path+'/'+f for f in current['artifacts']];diagnosticfiles=[diagnostic_path+'/'+f for f in diagnostic['artifacts']]
    for path,b in [(current_path,current),(diagnostic_path,diagnostic)]:
        for p,id in b['artifacts'].items():assert ident(ROOT/path/p)==id
    baseline=json.loads((ROOT/'manifests/runtime-baseline.json').read_text())
    for p,id in baseline['runtimes']['x86_64']['files'].items():assert ident(ROOT/p)==id
    originalfiles=[str(p.relative_to(ROOT))for p in sorted((ROOT/'runtime').rglob('*'))if p.is_file()and(p.suffix=='.mjs'or p.parent==ROOT/'runtime/x86_64')]
    inspect_path=ROOT/'experiments/memory32-rnds2/inspect-memory.py';spec=importlib.util.spec_from_file_location('memory_inspector',inspect_path);inspector=importlib.util.module_from_spec(spec);spec.loader.exec_module(inspector)
    inspection={k:inspector.inspect(ROOT/p/'qemu-system-x86_64.wasm')for k,p in [('original','runtime/x86_64'),('switch',current_path+'/runtime/x86_64'),('diagnostic',diagnostic_path+'/runtime/x86_64')]}
    for v in inspection.values():
        assert len(v['memories'])==len(v['tables'])==1 and v['memories'][0]['addressBits']==v['tables'][0]['addressBits']==64
        assert v['memories'][0]['shared'] and v['memories'][0]['minimum']*65536==2147483648
    script="import {readFile}from'node:fs/promises';let m=await WebAssembly.compile(await readFile(process.argv[1]));console.log(JSON.stringify(WebAssembly.Module.exports(m).map(x=>x.name)));"
    exports=json.loads(subprocess.check_output(['node','--input-type=module','-e',script,str(ROOT/current_path/'runtime/x86_64/qemu-system-x86_64.wasm')],text=True))
    assert all(n in exports for n in ['defuss_m2_msg1_config','defuss_m2_msg1_status'])
    assert not any(n.startswith(('defuss_m1_','defuss_m3','defuss_inline_rnds2_','defuss_m2_msg2'))or n=='defuss_m2_msg1_counts'for n in exports)
    checks=[];checkinputs=set()
    for cold in ['hot','cold']:
        for mode in ['off','on']:
            name=f'artifacts/m2-msg1-production-isa-{cold}-{mode}-01/report.json';r=json.loads((ROOT/name).read_text())
            assert r['status']=='passed' and r['executionCounts']is False and r['timingEligible']is False and r['lateConfigurationResult']==-1
            for p,h in r['inputHashes'].items():assert ident(ROOT/p)['sha256']==h,p;checkinputs.add(p)
            execution=f'artifacts/m2-msg1-production-isa-execution-{cold}-{mode}-01/execution.json';assert json.loads((ROOT/execution).read_text())['returncode']==0
            checks.extend([name,execution])
    for p in sources:
        if p.endswith('.py'):ast.parse((ROOT/p).read_text())
        elif p.startswith('benchmarks/harness/m2-msg1-timing/')and p.endswith('.mjs'):subprocess.run(['node','--check',p],check=True,cwd=ROOT)
    test=subprocess.run(['node','--test',str(HERE/'test.mjs')],check=True,capture_output=True,text=True,cwd=ROOT)
    spec=importlib.util.spec_from_file_location('analysis',HERE/'analyze.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    assert mod.estimate([1]*6)['interval95']==[1,1]
    a=mod.estimate([.8,.9,1,1.1,1.2,1.3]);b=mod.estimate([1/x for x in [.8,.9,1,1.1,1.2,1.3]])
    assert all(math.isclose(x*y,1,rel_tol=1e-12)for x,y in zip(a['interval95'],reversed(b['interval95'])))
    OUT.mkdir();(OUT/'host-tests.log').write_text(test.stdout+test.stderr)
    save(OUT/'validation.json',{'status':'passed','sourceFingerprint':current['sourceFingerprint'],'actualWasmExports':exports,'productionISA':checks,'binaryInspection':inspection,'proof':ident(ROOT/proof_path)})
    package='artifacts/m2-msg1-exposure-off-package-01';manifest=json.loads((ROOT/package/'app.json').read_text())
    guestfiles=[package+'/app.json']+[package+'/'+manifest['generation']+'/'+p for p in ['app.mjs','kernel','initramfs.cpio.gz','rom/bios-256k.bin','rom/kvmvapic.bin','rom/linuxboot_dma.bin']]
    extra=[current_path+'/build-report.json',diagnostic_path+'/build-report.json',accepted_path,proof_path,inventory_path,'artifacts/m2-msg1-host-01/report.json','artifacts/m2-msg1-diagnostic-review-01/review.json','artifacts/m2-msg1-exposure-review-01/review.json','manifests/runtime-baseline.json','artifacts/m3b-bun-code-attribution-off-01/progress.jsonl','scripts/build.py','scripts/sdk.py','scripts/runtime_dependencies.py','artifacts/memory32-rnds2-timing-analysis-01/analysis.json',str(inspect_path.relative_to(ROOT))]
    extra+=[str((ROOT/v['source']).with_name('source-m2-msg1-overlay.json').relative_to(ROOT))for v in proof['sources'].values()]
    extra+=[str((OUT/p).relative_to(ROOT))for p in ['validation.json','host-tests.log']]+checks
    inputs={p:ident(ROOT/p)for p in sorted(set(sources+currentfiles+diagnosticfiles+originalfiles+guestfiles+extra)|checkinputs)}
    for p in sources:
        dest=OUT/'source'/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/p,dest)
    orders=[['original','control','candidate'],['control','candidate','original'],['candidate','original','control'],['original','candidate','control'],['candidate','control','original'],['control','original','candidate']]
    assert len({tuple(x)for x in orders})==6
    steps=[]
    for block,order in enumerate(orders,1):
        for arm in order:
            key=f'block-{block:02d}-{arm}';steps.append({'id':key,'block':block,'arm':arm,'capture':'artifacts/m2-msg1-timing-01/'+key,'execution':'artifacts/m2-msg1-timing-execution-'+key+'-01'})
    node=Path(shutil.which('node')).resolve();chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    host_tools={'node':{'path':str(node),**ident(node),'version':subprocess.check_output([str(node),'--version'],text=True).strip()},'chrome':{'path':str(chrome),**ident(chrome),'version':subprocess.check_output([str(chrome),'--version'],text=True).strip()}}
    runtimes={'original':{'directory':'runtime/x86_64','files':originalfiles,'role':'retained RNDS2'},'control':{'directory':current_path+'/runtime/x86_64','files':currentfiles,'role':'same binary MSG1 off'},'candidate':{'directory':current_path+'/runtime/x86_64','files':currentfiles,'role':'same binary MSG1 on'},'diagnostic':{'directory':diagnostic_path+'/runtime/x86_64','files':diagnosticfiles,'timingEligible':False,'role':'MSG1 on with counters'}}
    assert runtimes['control']['directory']==runtimes['candidate']['directory'] and runtimes['control']['files']==runtimes['candidate']['files']
    save(OUT/'plan.json',{'schema':1,'status':'frozen','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'six-block same-binary MSG1 exploration','hostTools':host_tools,'runtimes':runtimes,'blocks':6,'timeoutMs':1800000,'snapshot':False,'inputs':inputs,'steps':steps,'statistics':{'primary':'sha256','unit':'independent cold launch paired within three-arm block','aggregation':'median of three 100-call batches','interval':'paired log Student t marginal 95%, df=5','retainAll':True,'poolWithOtherStudies':False,'meaningfulImprovement':0.05,'improvementDecision':'ON upper95 <1 versus both OFF and original RNDS2','fivePercentDecision':'ON upper95 <.95 versus both references','secondary':'descriptive only','confirmation':'A selected promising result requires a separately declared fresh confirmation'},'promotionBudgets':{'otherWorkloadTimeRatio':1.05,'readyRatio':1.05,'horizonRatio':1.05,'wasmBytesRatio':1.01,'linearMemoryBytes':2147483648,'instanceLimit':12000,'peakProcessMemoryRatio':1.05,'guestServiceLatencyRatio':1.05,'untestedGates':['peak process memory','guest service/interrupt latency','held-out application','other supported platforms'],'automaticPromotion':False}})
    print(json.dumps({'status':'frozen','inputs':len(inputs),'steps':len(steps)}))
if __name__=='__main__':main()
