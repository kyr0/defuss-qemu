#!/usr/bin/env python3
"""Verify the completed isolated build and publish its additional diagnostic binding."""
import datetime,hashlib,importlib.util,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def ident(path):
    b=path.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def ref(path):
    p=ROOT/path if isinstance(path,str) else path
    return {'path':str(p.relative_to(ROOT)),**ident(p)}
def read(name):return json.loads((ROOT/name).read_text())
def write(path,value):
    b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
    with path.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def main():
    out=ROOT/'artifacts/m3b-admission-postbuild-01';out.mkdir()
    try:
        prepath='artifacts/m3b-admission-prebuild-01/report.json';pre=read(prepath);assert pre['status']=='passed'
        for f in pre['files']:
            for key in ('path','archive'):assert ident(ROOT/f[key])=={k:f[k] for k in ('sha256','bytes')}
        spec=importlib.util.spec_from_file_location('admission',ROOT/'experiments/m3b-admission-diagnosis/prepare-admission.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        source=ROOT/pre['source'];fp,files=m.fingerprint(source);basefp,_=m.fingerprint(m.BASE)
        assert fp==pre['sourceFingerprint'] and basefp==pre['baseFingerprint']==m.FINGERPRINT
        old=read(pre['sourceInventory']['path']);assert ident(ROOT/pre['sourceInventory']['path'])=={k:pre['sourceInventory'][k] for k in ('sha256','bytes')}
        assert files==old['files']
        links=[]
        for p in source.rglob('*'):
            if p.is_symlink():links.append({'path':str(p.relative_to(ROOT)),'target':os.readlink(p),'resolved':str(p.resolve().relative_to(ROOT))})
        assert links==old['links'] and len(links)==14
        write(out/'source-inventory.json',(ROOT/pre['sourceInventory']['path']).read_bytes())
        buildpath='artifacts/m3b-admission-build-01/build-report.json';build=read(buildpath)
        assert build['status']=='passed' and build['sourceFingerprint']==fp and build['source']=='/project/'+pre['source']
        assert build['targets']==['x86_64-softmmu'] and all(r['returncode']==0 for r in build['runs'])
        parentpath='artifacts/m3b-context-v2-binding-01/binding.json';parent=read(parentpath);parentbuild=read(parent['buildReport']['path'])
        assert ref(parentpath)['sha256']=='fde6abcfa0cae40e8be1fed679f4e54783325ad16d8d88b9a9a0a517e35c4c22'
        assert build['sdk']==parentbuild['sdk'] and build['emccVersion']==parentbuild['emccVersion']
        commands=[[s.replace(parentbuild['source'],build['source']) for s in row] for row in parentbuild['commands']]
        assert build['commands']==commands,'Configure/compile settings changed'
        for path,id in build['artifacts'].items():assert ident(ROOT/'artifacts/m3b-admission-build-01'/path)==id
        assert sorted(build['artifacts'])==sorted(parentbuild['artifacts'])
        invocations=[]
        for p in (ROOT/'tmp').glob('sdk-*/invocation.json'):
            obj=json.loads(p.read_text())
            if obj.get('command',[])[-10:]==['python3','scripts/build.py','--source',pre['source'],'--output','artifacts/m3b-admission-build-01','--targets','x86_64-softmmu','--jobs','4']:invocations.append((p,obj))
        assert len(invocations)==1,'One exact SDK invocation';sdkpath,sdk=invocations[0]
        assert sdk['status']=='passed' and sdk['returncode']==0 and sdk['sdk']==build['sdk']
        assert '--network' in sdk['command'] and sdk['command'][sdk['command'].index('--network')+1]=='none'
        write(out/'sdk-invocation.json',sdkpath.read_bytes());write(out/'bind-runtime.py',Path(__file__).read_bytes())
        input_paths=[prepath,pre['sourceInventory']['path'],buildpath,'artifacts/m3b-admission-source-01/admission-overlay.json',parentpath,str(Path(__file__).relative_to(ROOT)),str(sdkpath.relative_to(ROOT)),str((out/'sdk-invocation.json').relative_to(ROOT)),str((out/'bind-runtime.py').relative_to(ROOT))]
        report={'schema':1,'status':'passed','source':pre['source'],'sourceFingerprint':fp,'sourceStable':True,'parentSourceStable':True,'sourceInventory':ref(out/'source-inventory.json'),'runtimeArtifacts':build['artifacts'],'inputs':{p:ident(ROOT/p) for p in input_paths},'sdkInvocation':ref(sdkpath),'authorship':'Root full source and runtime recheck, not an externally authored review.','timingEligible':False,'completedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        write(out/'report.json',report)
        binding={'schema':1,'kind':'m3b-admission-runtime-binding-v1','status':'passed','source':pre['source'],'sourceFingerprint':fp,'runtime':'artifacts/m3b-admission-build-01/runtime/x86_64','parent':ref(parentpath),'prebuild':ref(prepath),'postbuild':ref(out/'report.json'),'buildReport':ref(buildpath),'overlay':ref('artifacts/m3b-admission-source-01/admission-overlay.json'),'admissionAbi':{'version':1,'words':128},'timingEligible':False,'candidatePromotion':False,'scope':'Original ABI2 diagnostic runtime plus observation-only translation-admission bank; exact two-file overlay and full before/after source validation.'}
        target=ROOT/'artifacts/m3b-admission-binding-01';target.mkdir();write(target/'binding.json',binding)
        print(json.dumps({'status':'passed','binding':ref(target/'binding.json'),'sourceFingerprint':fp}))
    except Exception:
        import traceback
        write(out/'failure.json',{'status':'failed','failure':traceback.format_exc()});raise
if __name__=='__main__':main()
