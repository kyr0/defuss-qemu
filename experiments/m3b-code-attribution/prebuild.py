"""Verify exact four-file observer overlay and retain all pre-build identities."""
import datetime,hashlib,json,os
from pathlib import Path
import prepare as overlay
ROOT=overlay.ROOT;HERE=Path(__file__).resolve().parent
OUT=ROOT/'artifacts/m3b-code-attribution-prebuild-01'
def ident(p):return overlay.ident(p)
def write(p,value):
 b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
 with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def ref(p):return dict(path=str(p.relative_to(ROOT)),**ident(p))
def main():
 OUT.mkdir();report=dict(schema=1,status='failed',timingEligible=False)
 try:
  source=ROOT/'artifacts/m3b-code-attribution-source-01/source';record=source.parent/'attribution-overlay.json';o=json.loads(record.read_bytes());fp,files=overlay.fingerprint(source);bp,base=overlay.fingerprint(overlay.BASE);assert bp==o['baseFingerprint']==overlay.FINGERPRINT and fp==o['sourceFingerprint']
  actual=sorted(n for n in set(base)|set(files) if base.get(n)!=files.get(n));expected=overlay.patch(overlay.BASE);assert actual==sorted(expected)
  for n,text in expected.items():assert (source/n).read_bytes()==text.encode()
  assert len(actual)==4 and len(files)==len(base)+1
  links={str(p.relative_to(source)):os.readlink(p) for p in source.rglob('*') if p.is_symlink()};base_links={str(p.relative_to(overlay.BASE)):os.readlink(p) for p in overlay.BASE.rglob('*') if p.is_symlink()};assert links==base_links and len(links)==14
  for n in links:assert (source/n).resolve().is_relative_to(source) and (source/n).resolve().exists()
  tests=ROOT/'artifacts/m3b-code-attribution-host-tests-01/report.json';t=json.loads(tests.read_bytes());assert t['status']=='passed' and t['sourceStable'] and len(t['commands'])==4
  for n,id in t['sources'].items():assert ident(ROOT/n)==id
  write(OUT/'source-inventory.json',dict(files=files,links=links))
  paths=[*sorted(p for p in HERE.iterdir() if p.is_file()),tests,ROOT/'artifacts/m3b-context-v2-binding-01/binding.json',record,*[source/n for n in actual]];rows=[]
  for i,p in enumerate(paths):
   archive=OUT/(str(i).zfill(2)+'-'+p.name);write(archive,p.read_bytes());rows.append(dict(path=str(p.relative_to(ROOT)),archive=str(archive.relative_to(ROOT)),**ident(p)))
  report.update(status='passed',source=str(source.relative_to(ROOT)),sourceFingerprint=fp,baseFingerprint=bp,sourceFiles=len(files),sourceInventory=ref(OUT/'source-inventory.json'),files=rows,changes=actual,allOtherFilesByteIdentical=True,originalServiceFunctionUnchanged=True,originalCountdownAndPoolPredicateUnchanged=True,originalDescriptorLayoutUnchanged=True,scope='Exact source overlay only adds declarations and two observation calls with one fixed bank. No modified guard, frontend decision, IR, execution helper, pool policy or descriptor layout. Full native build and guest evidence remain required.',authorship='Root source inventory and integration checks; not an external independent audit.')
 except Exception:
  import traceback
  report['failure']=traceback.format_exc()
 report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write(OUT/'report.json',report);print(json.dumps({k:report[k] for k in ('status','sourceFiles','sourceFingerprint') if k in report}|({'failure':report['failure']} if 'failure' in report else {})));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
