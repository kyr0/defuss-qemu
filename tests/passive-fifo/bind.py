#!/usr/bin/env python3
"""Bind the reviewed diagnostic build using root's authoritative post-build audit."""
import argparse,hashlib,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FINGERPRINT='a212205ce5c8cbdd83dcf66ce8396ec3cdaa436037a77969963395f6e2b2a97c'
PINS={
 'artifacts/passive-fifo-overlay-source-01/manifest.json':'0b0007d3c3ccc9732a0a66c308b3f6db31ff27f15d4efc189579051f503fed27',
 'artifacts/passive-fifo-overlay-source-review-01/review.json':'2083b74b69137a0bbc235449a26a8c640110c8337fa71e3d75227649cd26c6e8',
 'artifacts/passive-fifo-build-review-tools-01/recheck.py':'a0131cadba9a82c47e1b5a7b1fdb72d151e740eee709b70326cffa89904b3b98',
}
AUDIT_SHA='798e2d6a9c9ad48a3ebb7266c6308a984cb8bd4e5aea35ab30bc51f1940e6766'
ARTIFACTS={'runtime/audio/backend.mjs','runtime/audio/pcm.mjs','runtime/audio/ringbuf.mjs','runtime/graphics.mjs','runtime/native-counters.mjs','runtime/x86_64/qemu-system-x86_64.js','runtime/x86_64/qemu-system-x86_64.wasm'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--build',required=True);ap.add_argument('--output',required=True);args=ap.parse_args()
 build=(ROOT/args.build).resolve();build.relative_to(ROOT/'artifacts');output=(ROOT/args.output).resolve();output.relative_to(ROOT/'artifacts')
 inputs={}
 def check(p,expected):
  assert sha(p)==expected,str(p);inputs[str(p.relative_to(ROOT))]=expected;return json.loads(p.read_text()) if p.suffix=='.json' else None
 for name,expected in PINS.items():check(ROOT/name,expected)
 audit=check(build/'source-recheck.json',AUDIT_SHA)
 assert audit['status']=='passed' and audit['kind']=='passive-fifo-postbuild-audit' and audit['variant']=='diagnostic'
 assert audit['sourceFingerprint']==FINGERPRINT and audit['files']==10103 and audit['overlayChanges']==7
 for field,name in [('frozenImplementation','artifacts/passive-fifo-overlay-source-01/manifest.json'),('sourceReview','artifacts/passive-fifo-overlay-source-review-01/review.json'),('reviewer','artifacts/passive-fifo-build-review-tools-01/recheck.py')]:assert audit[field]['sha256']==PINS[name]
 check(ROOT/audit['inventory']['path'],audit['inventory']['sha256'])
 source=ROOT/audit['source'];check(source.parent/(source.name+'-fifo-overlay.json'),audit['overlay']['sha256'])
 report=check(build/'build-report.json',audit['buildReport']['sha256']);assert report['status']=='passed' and report['sourceFingerprint']==FINGERPRINT and report['artifacts']==audit['runtimeArtifacts']
 assert set(report['artifacts'])==ARTIFACTS
 runtime=[]
 for name,item in report['artifacts'].items():
  p=build/name;assert sha(p)==item['sha256'] and p.stat().st_size==item['bytes'];runtime.append({'path':str(p.relative_to(ROOT)),**item})
 result={'schema':1,'kind':'passive-fifo-diagnostic-runtime-binding-v1','status':'verified','freeze':next(iter(PINS)),'freezeSha256':next(iter(PINS.values())),'buildReport':str((build/'build-report.json').relative_to(ROOT)),'sourceRecheck':str((build/'source-recheck.json').relative_to(ROOT)),'sourceRecheckSha256':AUDIT_SHA,'sourceFingerprint':FINGERPRINT,'sourceFiles':audit['files'],'variant':'diagnostic','runtime':runtime,'inputs':inputs,'scope':'Consumes root authoritative postbuild source audit, pinned reviewer/frozen review and exact seven runtime bytes. No repeated source audit or guest launch. Observer derivation is separate and WASM remains unchanged.'}
 output.parent.mkdir(parents=True,exist_ok=True)
 with output.open('x') as f:json.dump(result,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 fd=os.open(output.parent,os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)
 print(output)
if __name__=='__main__':main()
