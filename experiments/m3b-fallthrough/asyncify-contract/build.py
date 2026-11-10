#!/usr/bin/env python3
"""Build a standalone real-Asyncify service contract in the pinned SDK.

Source draft: root authorizes execution only outside timing. Never builds QEMU.
"""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SDK = 'registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812'
BASE = 'artifacts/m3a-source-04/source/tcg/wasm64.c'
def identity(data): return {'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
def write(path,data):
    if not isinstance(data,bytes): data=(json.dumps(data,indent=2)+'\n').encode()
    with path.open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_RDONLY); os.fsync(fd); os.close(fd)
def main():
    ap=argparse.ArgumentParser(description=__doc__); ap.add_argument('--output',required=True); args=ap.parse_args()
    assert str(ROOT)=='/project','Use scripts/sdk.py in the pinned SDK'
    assert re.fullmatch(r'artifacts/[A-Za-z0-9_.-]+',args.output)
    out=ROOT/args.output; out.mkdir()
    fd=os.open(out.parent,os.O_RDONLY); os.fsync(fd); os.close(fd)
    report={'schema':1,'kind':'m3b-actual-asyncify-contract-build','status':'failed','sdk':SDK,
            'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commands':[],
            'timingEligible':False,'guestExecution':False,'qemuRuntimeChanged':False}
    source_names=[BASE,*(str((HERE/n).relative_to(ROOT)) for n in ['build.py','contract.c','observer-pre.js','run.mjs','README.md']),
                  'experiments/m3b-fallthrough/core.h','experiments/m3b-fallthrough/runtime-service.inc',
                  'scripts/sdk.py','scripts/build.py','scripts/container_engine.py']
    data={n:(ROOT/n).read_bytes() for n in source_names}; report['sources']={n:identity(b) for n,b in data.items()}
    write(out/'started.json',report)
    def command(argv):
        p=subprocess.run(argv,cwd=out,capture_output=True,timeout=180)
        row={'argv':argv,'returncode':p.returncode,'stdout':p.stdout.decode(errors='replace'),'stderr':p.stderr.decode(errors='replace')}
        report['commands'].append(row); write(out/f'command-{len(report["commands"]):02}.json',row)
        if p.returncode: raise RuntimeError('Failed '+repr(argv))
        return p.stdout
    try:
        invpath=Path(os.environ['TMPDIR'])/'invocation.json'; assert invpath.parent.parent==ROOT/'tmp'
        invbytes=invpath.read_bytes(); inv=json.loads(invbytes)
        assert inv['status']=='running' and inv['sdk']==SDK and inv['containerScratch']==str(invpath.parent)
        assert inv['command'][-4:]==['python3',str(HERE.relative_to(ROOT)/'build.py'),'--output',args.output]
        assert inv['command'].count(SDK)==1 and ['--network','none']==inv['command'][inv['command'].index('--network'):inv['command'].index('--network')+2]
        write(out/'sdk-invocation-start.json',invbytes)
        report['sdkInvocation']=str(invpath.relative_to(ROOT))
        for name in ['contract.c','observer-pre.js']:
            write(out/name,data[str((HERE/name).relative_to(ROOT))])
        for name in ['core.h','runtime-service.inc']:
            write(out/name,data['experiments/m3b-fallthrough/'+name])
        original=data[BASE].decode()
        match=re.search(r'^static inline void trysleep\(void\)\n\{.*?^\}',original,re.M|re.S)
        assert match and original.count('#define MAX_EXEC_NUM 50000\nstatic __thread int exec_cnt = MAX_EXEC_NUM;\n')==1
        extracted='#define MAX_EXEC_NUM 50000\nstatic __thread int exec_cnt = MAX_EXEC_NUM;\n'+match[0]+'\n'
        write(out/'original-trysleep.inc',extracted.encode()); report['extractedTrysleep']=identity(extracted.encode())
        emcc=Path(shutil.which('emcc') or '/missing').resolve(); assert emcc.is_file()
        report['compiler']={'path':str(emcc),**identity(emcc.read_bytes()),'version':command([str(emcc),'--version']).decode()}
        flags=['-O2','-std=c11','-Wall','-Wextra','-Werror','-pthread','-msimd128','-m64','-sMEMORY64=1',
               '-sASYNCIFY=1','-sWASM_BIGINT','-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=node',
               '-sALLOW_TABLE_GROWTH=1','-sINITIAL_MEMORY=64MB','-sMAXIMUM_MEMORY=64MB',
               '-sSTACK_SIZE=1048576','-sDEFAULT_PTHREAD_STACK_SIZE=1048576','-sSTACK_OVERFLOW_CHECK=2',
               '-sEXPORTED_RUNTIME_METHODS=ccall','--no-entry','--pre-js',str(out/'observer-pre.js')]
        command([str(emcc),*flags,str(out/'contract.c'),'-o',str(out/'contract.mjs')])
        original_js=(out/'contract.mjs').read_text(); observed=original_js
        patches=[
          ('start-unwind','runAndAbortIfError(()=>_asyncify_start_unwind(Asyncify.currData))',
           'runAndAbortIfError(()=>m3bContractTransition(1,()=>_asyncify_start_unwind(Asyncify.currData)))'),
          ('stop-unwind','runAndAbortIfError(_asyncify_stop_unwind)',
           'runAndAbortIfError(()=>m3bContractTransition(2,_asyncify_stop_unwind))'),
          ('start-rewind','runAndAbortIfError(()=>_asyncify_start_rewind(Asyncify.currData))',
           'runAndAbortIfError(()=>m3bContractTransition(3,()=>_asyncify_start_rewind(Asyncify.currData)))'),
          ('stop-rewind','runAndAbortIfError(_asyncify_stop_rewind)',
           'runAndAbortIfError(()=>m3bContractTransition(4,_asyncify_stop_rewind))')]
        anchors=[]
        for name,before,after in patches:
            assert observed.count(before)==1,('Asyncify anchor',name,observed.count(before))
            observed=observed.replace(before,after); anchors.append({'name':name,'before':identity(before.encode()),'after':identity(after.encode()),'count':1})
        write(out/'contract-observed.mjs',observed.encode())
        write(out/'derivation.json',{'schema':1,'kind':'m3b-standalone-asyncify-observer','originalJs':identity(original_js.encode()),
              'derivedJs':identity(observed.encode()),'wasm':identity((out/'contract.wasm').read_bytes()),'wasmChanged':False,
              'newYield':False,'forceGC':False,'anchors':anchors})
        for name,b in data.items(): assert (ROOT/name).read_bytes()==b,'Source changed: '+name
        artifacts={}
        for p in sorted(out.iterdir()):
            if p.is_file():
                with p.open('rb') as f: os.fsync(f.fileno())
                artifacts[p.name]=identity(p.read_bytes())
        report.update(status='passed',artifacts=artifacts,validation='Compilation and exact glue derivation only; actual Asyncify run remains required.')
    except Exception as e: report['failure']=repr(e)
    finally: write(out/'build-report.json',report)
    print(json.dumps({'status':report['status'],'output':args.output})); return 0 if report['status']=='passed' else 1
if __name__=='__main__': raise SystemExit(main())
