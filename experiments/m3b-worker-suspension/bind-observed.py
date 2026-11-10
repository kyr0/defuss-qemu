"""Bind fresh derived JS and unchanged actual native build assets separately."""
import hashlib,importlib.util,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
def ident(p):
 b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def ref(p):return {'path':str(p.relative_to(ROOT)),**ident(p)}
def write(p,b):
 p.parent.mkdir(parents=True,exist_ok=True)
 if not isinstance(b,bytes):b=(json.dumps(b,indent=2)+'\n').encode()
 with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def main():
 native=ROOT/'artifacts/m3b-worker-suspension-binding-01/binding.json';n=json.loads(native.read_bytes());assert n['status']=='passed'
 bp=ROOT/n['buildReport']['path'];assert ident(bp)=={k:n['buildReport'][k] for k in ['sha256','bytes']};build=json.loads(bp.read_bytes());assert build['status']=='passed'
 dp=ROOT/'artifacts/m3b-worker-suspension-js-01/derivation.json';d=json.loads(dp.read_bytes());assert d['status']=='derived'
 for k in ['original','derived','observer','tool']:assert ident(ROOT/d[k]['path'])=={x:d[k][x] for x in ['sha256','bytes']}
 assert d['original']['path']==str((bp.parent/'runtime/x86_64/qemu-system-x86_64.js').relative_to(ROOT))
 spec=importlib.util.spec_from_file_location('frozen_deriver',HERE/'derive-js.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 assert d['replacements']==mod.REPLACEMENTS and len(d['replacements'])==6
 expected=mod.derive((ROOT/d['original']['path']).read_text(),(ROOT/d['observer']['path']).read_text()).encode();assert expected==(ROOT/d['derived']['path']).read_bytes()
 out=ROOT/'artifacts/m3b-worker-suspension-observed-binding-01';out.mkdir();assets={}
 for name,id in build['artifacts'].items():
  src=bp.parent/name;assert ident(src)==id
  data=expected if name=='runtime/x86_64/qemu-system-x86_64.js' else src.read_bytes();write(out/name,data);assets[name]=ident(out/name)
 inputs=[native,bp,dp,HERE/'bind-observed.py',ROOT/d['derived']['path'],ROOT/d['observer']['path'],ROOT/d['tool']['path'],dp.parent/'observer.js',dp.parent/'derive-js.py']
 assert ident(dp.parent/'observer.js')==ident(ROOT/d['observer']['path']);assert ident(dp.parent/'derive-js.py')==ident(ROOT/d['tool']['path'])
 write(out/'bind-observed.py',Path(__file__).read_bytes());inputs.append(out/'bind-observed.py')
 write(out/'binding.json',{'schema':1,'kind':'m3b-worker-suspension-observed-binding-v1','status':'passed','timingEligible':False,'candidatePromotion':False,'native':ref(native),'derivation':ref(dp),'runtime':str((out/'runtime/x86_64').relative_to(ROOT)),'artifacts':assets,'inputs':{str(p.relative_to(ROOT)):ident(p) for p in inputs},'scope':'Six exact glue anchors plus observer declarations; WASM and other five assets byte-identical to actual native build. No VM correctness or timing result yet.'})
 print(json.dumps({'status':'passed','binding':ref(out/'binding.json')}))
if __name__=='__main__':main()
