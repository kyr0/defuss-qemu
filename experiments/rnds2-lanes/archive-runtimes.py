#!/usr/bin/env python3
"""Durably archive and rehash all runtimes used by this engine investigation."""
import datetime,hashlib,json,os,uuid,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def identity(data):return {'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
def syncdir(p):
    fd=os.open(p,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def main():
    roots=['runtime']+['artifacts/'+n+'/runtime'for n in [
        'rnds2-setup-build-01','rnds2-setup-check-build-01','rnds2-setup-control-build-01',
        'rnds2-lanes-build-01','rnds2-lanes-check-build-01','rnds2-lanes-build-02','rnds2-lanes-check-build-02']]
    for name in roots:
        assert (ROOT/name).is_dir(),name
        if name!='runtime':assert json.loads((ROOT/name).parent.joinpath('build-report.json').read_text())['status']=='passed'
    key=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:10]
    stage=ROOT/'tmp'/('engine-runtime-archive-'+key);stage.mkdir()
    entries={};archive=stage/'runtimes.zip'
    with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6)as z:
        for name in roots:
            for p in sorted((ROOT/name).rglob('*')):
                if not p.is_file():continue
                assert not p.is_symlink(),p
                data=p.read_bytes();relative=str(p.relative_to(ROOT));entries[relative]=identity(data);z.writestr(relative,data)
    with archive.open('r+b')as f:os.fsync(f.fileno())
    with zipfile.ZipFile(archive)as z:
        assert z.testzip()is None and set(z.namelist())==set(entries)
        for p,id in entries.items():assert identity(z.read(p))==id==identity((ROOT/p).read_bytes()),p
    manifest={'status':'passed','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Exact runtime backup; source/evidence checkpoint is separate','archive':identity(archive.read_bytes()),'files':entries}
    with (stage/'manifest.json').open('x')as f:json.dump(manifest,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    syncdir(stage)
    dest=ROOT/'checkpoints'/('engine-runtimes-'+key);assert not dest.exists();stage.rename(dest);syncdir(dest.parent)
    # Read the published archive once more, so the final receipt names a verified path.
    assert identity((dest/'runtimes.zip').read_bytes())==manifest['archive']
    receipt=ROOT/'artifacts'/('engine-runtime-backup-'+key+'.json')
    with receipt.open('x')as f:json.dump({'status':'passed','directory':str(dest.relative_to(ROOT)),'manifest':identity((dest/'manifest.json').read_bytes()),'archive':manifest['archive'],'files':len(entries)},f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    syncdir(receipt.parent);print(receipt.read_text())
if __name__=='__main__':main()
