#!/usr/bin/env python3
"""Freeze the three-arm RNDS2 scalar-lane experiment before timing."""
import ast, datetime, hashlib, importlib.util, json, os, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'artifacts/rnds2-lanes-v2-timing-plan-01'
def ident(p):
    with p.open('rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def write(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x')as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    assert not OUT.exists()
    sources=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {sources}from'./benchmarks/harness/rnds2-lanes-v2-timing/identity.mjs';console.log(JSON.stringify(sources))"],cwd=ROOT,text=True))
    spec=importlib.util.spec_from_file_location('derive',ROOT/'experiments/rnds2-lanes/prepare-v2.py');mod=importlib.util.module_from_spec(spec)
    import sys
    sys.path.insert(0,str(ROOT/'experiments/rnds2-lanes'));spec.loader.exec_module(mod)
    overlay=json.loads((ROOT/'artifacts/rnds2-lanes-source-02/overlay.json').read_text())
    assert mod.inventory(mod.BASE)[0]==overlay['baseFingerprint']
    source=ROOT/overlay['source'];fp,files=mod.inventory(source);assert fp==overlay['sourceFingerprint']
    assert files==json.loads((source.parent/'inventory.json').read_text())['files']
    assert (source/mod.FILE).read_text()==mod.changed_v2((mod.BASE/mod.FILE).read_text())
    path='artifacts/rnds2-lanes-build-02/build-report.json';build=json.loads((ROOT/path).read_text());assert build['status']=='passed' and build['sourceFingerprint']==fp
    accepted=json.loads((ROOT/'artifacts/m3b-timing-build-01/build-report.json').read_text());assert build['sdk']==accepted['sdk'] and build['emccVersion']==accepted['emccVersion']
    assert build['commands']==[[s.replace(accepted['source'],build['source'])for s in row]for row in accepted['commands']]
    control_path='artifacts/rnds2-setup-control-build-01/build-report.json'
    control=json.loads((ROOT/control_path).read_text())
    assert control['status']=='passed' and control['sourceFingerprint']==overlay['baseFingerprint']
    assert control['sdk']==build['sdk'] and control['emccVersion']==build['emccVersion']
    assert control['commands']==[[s.replace(build['source'],control['source'])for s in row]for row in build['commands']]
    controlfiles=['artifacts/rnds2-setup-control-build-01/'+p for p in control['artifacts']]
    for p,id in control['artifacts'].items():assert ident(ROOT/'artifacts/rnds2-setup-control-build-01'/p)==id
    diagnostic_path='artifacts/rnds2-lanes-check-build-02/build-report.json'
    diagnostic=json.loads((ROOT/diagnostic_path).read_text());assert diagnostic['status']=='passed'
    checkroot=ROOT/'artifacts/rnds2-lanes-check-source-02'
    checkoverlay=json.loads((checkroot/'overlay.json').read_text())
    checkfp,checkfiles=mod.inventory(checkroot/'source')
    assert checkfp==checkoverlay['sourceFingerprint']==diagnostic['sourceFingerprint']
    assert checkoverlay['baseFingerprint']==fp
    assert checkfiles==json.loads((checkroot/'inventory.json').read_text())['files']
    for p,id in checkoverlay['inputs'].items():assert ident(ROOT/p)==id
    assert diagnostic['sdk']==build['sdk'] and diagnostic['emccVersion']==build['emccVersion']
    assert diagnostic['commands']==[[s.replace(build['source'],diagnostic['source'])for s in row]for row in build['commands']]
    diagnosticfiles=['artifacts/rnds2-lanes-check-build-02/'+p for p in diagnostic['artifacts']]
    for p,id in diagnostic['artifacts'].items():assert ident(ROOT/'artifacts/rnds2-lanes-check-build-02'/p)==id
    current='artifacts/rnds2-lanes-build-02/runtime/x86_64';original='runtime/x86_64'
    currentfiles=['artifacts/rnds2-lanes-build-02/'+p for p in build['artifacts']]
    for p,id in build['artifacts'].items():assert ident(ROOT/'artifacts/rnds2-lanes-build-02'/p)==id
    baseline=json.loads((ROOT/'manifests/runtime-baseline.json').read_text())
    for p,id in baseline['runtimes']['x86_64']['files'].items():assert ident(ROOT/p)==id
    originalfiles=[str(p.relative_to(ROOT))for p in sorted((ROOT/'runtime').rglob('*'))if p.is_file()and(p.suffix=='.mjs'or p.parent==ROOT/original)]
    script="import {readFile}from'node:fs/promises';let m=await WebAssembly.compile(await readFile(process.argv[1]));console.log(JSON.stringify(WebAssembly.Module.exports(m).map(x=>x.name)));"
    exports=json.loads(subprocess.check_output(['node','--input-type=module','-e',script,str(ROOT/current/'qemu-system-x86_64.wasm')],text=True))
    assert not any(n.startswith(('defuss_m1_','defuss_m3','defuss_inline_rnds2_'))for n in exports)
    checks=[];checkinputs=set()
    for mode in ['native','hot','cold','pshufb','production','rnds2']:
        name=f'artifacts/rnds2-lanes-validation-{mode}-02/report.json';report=json.loads((ROOT/name).read_text());assert report['status']=='passed'
        for p,id in report['inputs'].items():assert ident(ROOT/p)==id;checkinputs.add(p)
        checks.extend([name,f'artifacts/rnds2-lanes-validation-execution-{mode}-02/browser-cleanup.json'])
        assert json.loads((ROOT/checks[-1]).read_text())['status']=='passed'
    for p in sources:
        if p.endswith('.py'):ast.parse((ROOT/p).read_text())
        elif p.startswith('benchmarks/harness/rnds2-lanes-v2-timing/')and p.endswith('.mjs'):subprocess.run(['node','--check',p],check=True,cwd=ROOT)
    test=subprocess.run(['node','--test','benchmarks/harness/rnds2-lanes-v2-timing/test.mjs'],check=True,capture_output=True,text=True,cwd=ROOT)
    OUT.mkdir();(OUT/'host-tests.log').write_text(test.stdout+test.stderr)
    write(OUT/'validation.json',{'status':'passed','sourceFingerprint':fp,'actualWasmExports':exports,'nativeChecks':checks})
    package='artifacts/m2-msg1-exposure-off-package-01';manifest=json.loads((ROOT/package/'app.json').read_text())
    guestfiles=[package+'/app.json']+[package+'/'+manifest['generation']+'/'+p for p in ['app.mjs','kernel','initramfs.cpio.gz','rom/bios-256k.bin','rom/kvmvapic.bin','rom/linuxboot_dma.bin']]
    extra=[path,'artifacts/rnds2-lanes-source-02/overlay.json','artifacts/rnds2-lanes-source-02/inventory.json','manifests/runtime-baseline.json','artifacts/m3b-bun-code-attribution-off-01/progress.jsonl','scripts/build.py','scripts/sdk.py','scripts/runtime_dependencies.py','artifacts/rnds2-lanes-v2-timing-plan-01/validation.json','artifacts/rnds2-lanes-v2-timing-plan-01/host-tests.log']+checks
    for name in ['overlay.json','inventory.json']:extra.append('artifacts/rnds2-lanes-check-source-02/'+name)
    emitter=ROOT/'artifacts/rnds2-lanes-emitter-04'
    assert json.loads((emitter/'tests.json').read_text())['checks']==40960
    for p,id in json.loads((emitter/'inputs.json').read_text()).items():assert ident(ROOT/p)==id
    for p in emitter.iterdir():
        if p.is_file() and p.suffix in ['.json','.c','.body','.wasm','.log']:extra.append(str(p.relative_to(ROOT)))
    codegen=ROOT/'artifacts/rnds2-lanes-node-codegen-03'
    cg=json.loads((codegen/'report.json').read_text());assert cg['status']=='passed' and cg['timingEligible']is False
    for p,id in cg['inputs'].items():assert ident(ROOT/p)==id;extra.append(p)
    for p in codegen.iterdir():
        if p.is_file():extra.append(str(p.relative_to(ROOT)))
    extra+=['research/engines/lane-codegen-results-01.md','artifacts/rnds2-lanes-codegen-analysis-02/analysis.json']
    inputs={p:ident(ROOT/p)for p in sorted(set(sources+currentfiles+controlfiles+diagnosticfiles+originalfiles+guestfiles+extra+[control_path,diagnostic_path])|checkinputs)}
    for p in sources:
        target=OUT/'source'/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((ROOT/p).read_bytes())
    steps=[]
    for block in range(1,5):
        for arm in (['original','control','candidate']if block%2 else ['candidate','control','original']):
            name=f'block-{block:02d}-{arm}';steps.append({'id':name,'block':block,'arm':arm,'capture':'artifacts/rnds2-lanes-v2-timing-01/'+name,'execution':'artifacts/rnds2-lanes-v2-timing-execution-'+name+'-01'})
    node=Path(shutil.which('node')).resolve();chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    host_tools={'node':{'path':str(node),**ident(node),'version':subprocess.check_output([str(node),'--version'],text=True).strip()},'chrome':{'path':str(chrome),**ident(chrome),'version':subprocess.check_output([str(chrome),'--version'],text=True).strip()}}
    write(OUT/'plan.json',{'schema':1,'status':'frozen','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hostTools':host_tools,'blocks':4,'timeoutMs':1800000,'snapshot':False,'kind':'exploration','statistics':{'unit':'independent cold launch paired within block','batchAggregation':'median of three same-workload 100-call batches','ratio':'candidate/original, candidate/control, control/original time','primary':'sha256','interval':'paired log Student t marginal 95%, df=3','retainAll':True},'runtimes':{'original':{'directory':original,'files':originalfiles},'control':{'directory':'artifacts/rnds2-setup-control-build-01/runtime/x86_64','files':controlfiles},'candidate':{'directory':current,'files':currentfiles},'diagnostic':{'directory':'artifacts/rnds2-lanes-check-build-02/runtime/x86_64','files':diagnosticfiles,'timingEligible':False}},'inputs':inputs,'steps':steps})
    print(json.dumps({'status':'frozen','inputs':len(inputs),'steps':len(steps)}))
if __name__=='__main__':main()
