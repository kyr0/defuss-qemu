#!/usr/bin/env python3
"""Retain host checks, verify the actual runtime closure, then freeze the harness."""
import ast,datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PREFIX='artifacts/m3b-bun-code-attribution-'
HARNESS=ROOT/'benchmarks/harness/m3b-code-attribution'
def identity(p):
    b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def write(p,value):
    b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
    with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def main():
    assert Path(os.environ['TMPDIR']).resolve().is_relative_to(ROOT/'tmp')
    tests=ROOT/(PREFIX+'host-tests-01');tests.mkdir();commands=[]
    files=sorted(p for p in HARNESS.iterdir() if p.is_file());assert len(files)==12
    inventory={str(p.relative_to(ROOT)):identity(p) for p in files}
    def run(argv):
        index=len(commands);r=subprocess.run(argv,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        write(tests/f'{index:02d}.stdout',r.stdout);write(tests/f'{index:02d}.stderr',r.stderr)
        commands.append({'argv':argv,'returncode':r.returncode});assert r.returncode==0,argv
    report={'status':'failed','inputs':inventory,'commands':commands,'timingEligible':False}
    try:
        run(['node','--test','--test-concurrency=1',str(HARNESS/'test.mjs'),str(HARNESS/'test-code.mjs')])
        for p in files:
            if p.suffix=='.mjs':run(['node','--check',str(p)])
            if p.suffix=='.py':ast.parse(p.read_text())
        assert inventory=={str(p.relative_to(ROOT)):identity(p) for p in files}
        report['status']='passed'
    finally:write(tests/'report.json',report)
    pre=ROOT/(PREFIX+'preflight-01');pre.mkdir()
    code="""
import assert from 'node:assert/strict';
import {verifyCodeBinding} from './benchmarks/harness/m3b-code-attribution/runtime-identity.mjs';
import {bindingPath,bindingSha256} from './benchmarks/harness/m3b-code-attribution/config.mjs';
import {sources,identity} from './benchmarks/harness/m3b-code-attribution/identity.mjs';
const proof=await verifyCodeBinding(process.cwd(),bindingPath);proof.buffers.clear();
assert.equal(proof.inputs[bindingPath].sha256,bindingSha256);
for(const p of sources)proof.inputs[p]=await identity(p);
console.log(JSON.stringify({status:'passed',sourceFingerprint:proof.sourceFingerprint,inputs:proof.inputs,timingEligible:false}));
"""
    write(pre/'preflight.mjs',code.encode());r=subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    write(pre/'stdout.log',r.stdout);write(pre/'stderr.log',r.stderr);assert r.returncode==0,r.stderr.decode()
    proof=json.loads(r.stdout);assert proof['status']=='passed';write(pre/'report.json',proof)
    out=ROOT/(PREFIX+'source-01');out.mkdir();entries=[]
    for p in files:
        assert identity(p)==inventory[str(p.relative_to(ROOT))]
        dest=out/p.name;write(dest,p.read_bytes());entries.append({'path':str(p.relative_to(ROOT)),**identity(p),'archive':str(dest.relative_to(ROOT))})
    script=Path(__file__);write(out/script.name,script.read_bytes())
    dependencies={**proof['inputs'],str(script.relative_to(ROOT)):identity(script),
                  'experiments/m3b-code-attribution/DESIGN.md':identity(ROOT/'experiments/m3b-code-attribution/DESIGN.md')}
    manifest={'status':'passed','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':entries,'dependencies':dependencies,
              'hostTests':{'path':str((tests/'report.json').relative_to(ROOT)),**identity(tests/'report.json')},
              'preflight':{'path':str((pre/'report.json').relative_to(ROOT)),**identity(pre/'report.json')},
              'freezer':{'path':str(script.relative_to(ROOT)),**identity(script),'archive':str((out/script.name).relative_to(ROOT))},
              'timingEligible':False,'capturePolicy':'Exactly one OFF and one ON; no retry to obtain positive exposure.'}
    write(out/'manifest.json',manifest);print(json.dumps({'status':'passed','files':len(entries),'dependencies':len(dependencies)}))
if __name__=='__main__':main()
