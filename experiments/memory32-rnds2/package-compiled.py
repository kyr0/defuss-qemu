#!/usr/bin/env python3
"""Recover only packaging from the preserved, successfully linked first build."""
import datetime,hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts'))
from runtime_dependencies import stage_dependencies

def ident(p):
    with p.open('rb')as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    return {'sha256':h,'bytes':p.stat().st_size}
def main():
    old=ROOT/'artifacts/memory32-rnds2-build-01';out=ROOT/'artifacts/memory32-rnds2-build-02'
    before=json.loads((old/'build-report.json').read_text());assert before['status']=='failed'
    assert [r['step']for r in before['runs']]==['configure','compile']and all(r['returncode']==0 for r in before['runs'])
    assert 'expose-profile.py' in before['failure']
    out.mkdir();runtime=out/'runtime/x86_64';runtime.mkdir(parents=True)
    inputs={str((old/'build-report.json').relative_to(ROOT)):ident(old/'build-report.json')}
    report={**before,'status':'running','scope':'Same successfully linked bytes from failed attempt 01; fresh memory32-compatible packaging; no recompilation','packagingStartedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'priorFailure':before['failure'],'inputs':inputs};report.pop('failure')
    def save():
        with (out/'build-report.json').open('w')as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    save()
    try:
        for suffix in ['js','wasm','worker.js','worker.mjs']:
            p=old/'build'/('qemu-system-x86_64.'+suffix)
            if p.exists():inputs[str(p.relative_to(ROOT))]=ident(p);shutil.copyfile(p,runtime/p.name)
        for name in ['scripts/fix-emscripten-poll.py','experiments/memory32-rnds2/expose-profile.py']:
            inputs[name]=ident(ROOT/name);subprocess.run([sys.executable,'-B',str(ROOT/name),str(runtime/'qemu-system-x86_64.js')],check=True)
        for name in ['scripts/helper-profile-runtime.js','scripts/native-unwind-runtime.js','scripts/runtime_dependencies.py','experiments/memory32-rnds2/package-compiled.py']:inputs[name]=ident(ROOT/name)
        stage_dependencies(runtime,ROOT/'host/browser',out/'runtime')
        report['artifacts']={str(p.relative_to(out)):ident(p)for p in sorted((out/'runtime').rglob('*'))if p.is_file()}
        assert ident(runtime/'qemu-system-x86_64.wasm')==ident(old/'build/qemu-system-x86_64.wasm')
        for p,id in inputs.items():assert ident(ROOT/p)==id
        report['status']='passed'
    except Exception as error:report.update(status='failed',failure=str(error));raise
    finally:report['packagingCompletedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
    print(json.dumps({'status':'passed','output':str(out.relative_to(ROOT)),'wasm':ident(runtime/'qemu-system-x86_64.wasm')}))
if __name__=='__main__':main()
