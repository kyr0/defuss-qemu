#!/usr/bin/env python3
"""Add bounded worker-suspension observations in a new copy of the frozen ABI2 tree."""
import argparse,hashlib,json,os,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
BASE=ROOT/'artifacts/m3b-context-v2-source-01/source'
FINGERPRINT='46499e15df66b2f8d363d35846812bf99685ac2da44727d54494890e459ea321'
def ident(path):
    b=path.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def fingerprint(source):
    h=hashlib.sha256();files={}
    for p in sorted(source.rglob('*')):
        if not p.is_file() or '__pycache__' in p.parts or p.suffix=='.pyc':continue
        name=p.relative_to(source).as_posix();identity=ident(p);files[name]=identity
        h.update(name.encode()+b'\0');h.update(bytes.fromhex(identity['sha256']))
    return h.hexdigest(),files
def patch(source):
    path='tcg/wasm64.c';text=(source/path).read_text()
    replacements={
      '#include "m3b-runtime-service.inc"':'#include "m3s-observer.inc"\n#include "m3b-runtime-service.inc"',
      '        uint64_t m3b_entry_pc = m3b_runtime_pc(env);':'        uint64_t m3b_entry_pc = m3b_runtime_pc(env);\n#ifdef TARGET_X86_64\n        const void *m3s_owner = ctx.tb_ptr;\n#endif',
      '        m3b_service_after_call(env, m3b_entry_pc);':'''#ifdef TARGET_X86_64
        unsigned m3s_token = 0;
        if (env->m3b_service_debt && exec_cnt == 1 && !can_add_instance()) {
            m3s_token = m3s_before(env, m3s_owner, m3b_entry_pc, tb_func != NULL);
        }
#endif
        m3b_service_after_call(env, m3b_entry_pc);
#ifdef TARGET_X86_64
        m3s_after(env, m3s_token);
#endif''',
    }
    for old,new in replacements.items():
        assert text.count(old)==1,'Original observation anchor '+old
        text=text.replace(old,new)
    return {path:text,'tcg/m3s-observer.inc':(HERE/'observer.inc').read_text()}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);ap.add_argument('--check',action='store_true');args=ap.parse_args()
    output=(ROOT/args.output).resolve();assert output.is_relative_to(ROOT/'artifacts') and not output.exists() and output!=BASE
    before,files=fingerprint(BASE);assert before==FINGERPRINT
    changed=patch(BASE)
    if args.check:print(json.dumps({'status':'anchors-passed','changes':list(changed),'sourceFingerprint':before}));return
    output.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(BASE,output,symlinks=True);assert fingerprint(output)==(before,files)
    changes=[]
    for name,text in changed.items():
        dest=output/name
        with dest.open('w' if dest.exists() else 'x') as f:f.write(text);f.flush();os.fsync(f.fileno())
        changes.append({'path':name,'before':files.get(name),'after':ident(dest)})
    after,new_files=fingerprint(output);assert fingerprint(BASE)==(before,files)
    report={'schema':1,'kind':'m3b-worker-suspension-observation-overlay-v1','base':str(BASE),'baseFingerprint':before,'baseFiles':len(files),'source':str(output),'sourceFingerprint':after,'sourceFiles':len(new_files),'changes':changes,'sources':{str(p.relative_to(ROOT)):ident(p) for p in [Path(__file__),HERE/'observer.inc']},'timingEligible':False,'defaultEnabled':False,'runtimeValidation':'none','scope':'Bounded candidate observations around the unchanged service helper and countdown/full-pool predicate; no added sleep, countdown reset, forced collection or guard change.'}
    with (output.parent/'suspension-overlay.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    print(json.dumps({'status':'prepared','sourceFingerprint':after,'changes':len(changes),'files':len(new_files)}))
if __name__=='__main__':main()
