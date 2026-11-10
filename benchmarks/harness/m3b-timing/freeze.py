#!/usr/bin/env python3
"""Bind exact native derivation, measurement sources and declared order before runs."""
import ast,datetime,hashlib,importlib.util,json,os,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'artifacts/m3b-idle-timing-plan-01'
def ident(p):
    with p.open('rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def write(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x') as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    assert not OUT.exists();OUT.mkdir()
    prepare=ROOT/'experiments/m3b-timing/prepare.py';spec=importlib.util.spec_from_file_location('derive',prepare);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    overlay=json.loads((ROOT/'artifacts/m3b-timing-source-01/overlay.json').read_text());assert overlay['generator']==ident(prepare)
    fp,files=mod.inventory(mod.OUT);assert fp==overlay['sourceFingerprint'];assert mod.inventory(mod.BASE)[0]==overlay['baseFingerprint']==mod.EXPECTED
    inv=json.loads((ROOT/'artifacts/m3b-timing-source-01/inventory.json').read_text());assert files==inv['files'];assert inv['links']=={str(p.relative_to(mod.OUT)):os.readlink(p)for p in mod.OUT.rglob('*')if p.is_symlink()}
    for name,text in mod.derive().items():assert (mod.OUT/name).read_text()==text
    build_path='artifacts/m3b-timing-build-01/build-report.json';build=json.loads((ROOT/build_path).read_text());assert build['status']=='passed' and build['sourceFingerprint']==fp
    parent=json.loads((ROOT/'artifacts/m3b-context-v2-build-01/build-report.json').read_text());assert build['sdk']==parent['sdk'] and build['emccVersion']==parent['emccVersion'];assert build['commands']==[[s.replace(parent['source'],build['source'])for s in row]for row in parent['commands']]
    current='artifacts/m3b-timing-build-01/runtime/x86_64';original='runtime/x86_64'
    currentfiles=[]
    for p,id in build['artifacts'].items():
        name='artifacts/m3b-timing-build-01/'+p;assert ident(ROOT/name)==id;currentfiles.append(name)
    baseline=json.loads((ROOT/'manifests/runtime-baseline.json').read_text())
    for p,id in baseline['runtimes']['x86_64']['files'].items():assert ident(ROOT/p)==id
    originalfiles=[str(p.relative_to(ROOT))for p in sorted((ROOT/'runtime').rglob('*'))if p.is_file() and (p.suffix=='.mjs' or p.parent==ROOT/original)]
    # Verify diagnostic exports are absent in actual emitted native module.
    script="import {readFile}from'node:fs/promises';let m=await WebAssembly.compile(await readFile(process.argv[1]));console.log(JSON.stringify(WebAssembly.Module.exports(m).map(x=>x.name)));"
    exports=json.loads(subprocess.check_output(['node','--input-type=module','-e',script,str(ROOT/current/'qemu-system-x86_64.wasm')],text=True))
    forbidden=['defuss_m3_data','defuss_m3_watch','defuss_m3_test_inject','defuss_m3b_data','defuss_m3b_boundary_data','defuss_m3cc_data','defuss_m3co_data','defuss_m1_data']
    for n in forbidden:assert n not in exports and '_'+n not in exports,n
    for n in ['defuss_m3_configure','defuss_m3b_configure','defuss_m3b_status']:assert n in exports or '_'+n in exports,n
    js="import {sources}from'./benchmarks/harness/m3b-timing/identity.mjs';console.log(JSON.stringify(sources));"
    sources=json.loads(subprocess.check_output(['node','--input-type=module','-e',js],text=True,cwd=ROOT))
    tests=[]
    for p in sources:
        if p.endswith('.py'):ast.parse((ROOT/p).read_text());tests.append({'file':p,'check':'AST passed'})
        elif p.startswith('benchmarks/harness/m3b-timing/')and p.endswith('.mjs'):
            subprocess.run(['node','--check',p],check=True,cwd=ROOT);tests.append({'file':p,'check':'syntax passed'})
    test=subprocess.run(['node','--test','benchmarks/harness/m3b-timing/test.mjs'],check=True,capture_output=True,text=True,cwd=ROOT)
    (OUT/'host-tests.log').write_text(test.stdout+test.stderr)
    write(OUT/'validation.json',{'status':'passed','sourceFingerprint':fp,'sourceFiles':len(files),'sourceLinks':len(inv['links']),'sourceStable':True,'parentStable':True,'actualWasmExports':exports,'forbiddenExportsAbsent':forbidden,'checks':tests})
    package='artifacts/m2-msg1-exposure-off-package-01';manifest=json.loads((ROOT/package/'app.json').read_text())
    guestfiles=[package+'/app.json']+[package+'/'+manifest['generation']+'/'+p for p in ['app.mjs','kernel','initramfs.cpio.gz','rom/bios-256k.bin','rom/kvmvapic.bin','rom/linuxboot_dma.bin']]
    extra=[build_path,'artifacts/m3b-timing-source-01/overlay.json','artifacts/m3b-timing-source-01/inventory.json','manifests/runtime-baseline.json','artifacts/m3b-bun-code-attribution-off-01/progress.jsonl','scripts/build.py','scripts/sdk.py','scripts/container_engine.py','scripts/runtime_dependencies.py','artifacts/m3b-idle-timing-plan-01/validation.json','artifacts/m3b-idle-timing-plan-01/host-tests.log']
    inputs={p:ident(ROOT/p)for p in sorted(set(sources+currentfiles+originalfiles+guestfiles+extra))}
    # Save the exact authored measurement code before the first native launch.
    for p in sources:
        target=OUT/'source'/p;target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb')as f:f.write((ROOT/p).read_bytes());f.flush();os.fsync(f.fileno())
    steps=[]
    for block in range(1,5):
        order=['original','off','on']if block%2 else ['on','off','original']
        for arm in order:
            name=f'block-{block:02d}-{arm}';steps.append({'id':name,'block':block,'arm':arm,'capture':'artifacts/m3b-idle-timing-01/'+name,'execution':'artifacts/m3b-idle-timing-execution-'+name+'-01'})
    node=Path(shutil.which('node')).resolve();chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    host_tools={'node':{'path':str(node),**ident(node),'version':subprocess.check_output([str(node),'--version'],text=True).strip()},'chrome':{'path':str(chrome),**ident(chrome),'version':subprocess.check_output([str(chrome),'--version'],text=True).strip()}}
    plan={'hostTools':host_tools,'schema':1,'status':'frozen','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorization':'User requested fresh measurement against original baseline and reported zero unrelated host load; 30-minute capture deadline explicitly accepted.','kind':'exploration','blocks':4,'timeoutMs':1800000,'snapshot':False,'scope':'Restricted profile, unchanged Bun kernels; current clean M3b ON/OFF and original RNDS2, no promotion.','statistics':{'unit':'independent cold launch, paired within block','batchAggregation':'median of three same-workload 100-call batches','ratio':'candidate/control time','interval':'paired log Student t marginal 95%, df=3, critical=3.182446305284263','primary':'integer','retainAll':True},'runtimes':{'original':{'directory':original,'files':originalfiles},'off':{'directory':current,'files':currentfiles},'on':{'directory':current,'files':currentfiles}},'inputs':inputs,'steps':steps}
    write(OUT/'plan.json',plan);fd=os.open(OUT,os.O_RDONLY);os.fsync(fd);os.close(fd);print(json.dumps({'status':'frozen','inputs':len(inputs),'steps':len(steps),'sourceFingerprint':fp}))
if __name__=='__main__':main()
