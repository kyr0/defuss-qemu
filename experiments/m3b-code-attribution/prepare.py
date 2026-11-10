#!/usr/bin/env python3
"""Add bounded code-attribution observations in a new copy of the frozen ABI2 tree."""
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
    changes={}
    path='include/qemu/m3b-profile.h';text=(source/path).read_text();old='unsigned defuss_m3b_profile_status(void);';assert text.count(old)==1
    changes[path]=text.replace(old,old+'\nvoid defuss_m3co_formed(const void *env, const void *tb, uint64_t pc,\n                        const void *host, unsigned bytes);')
    path='target/i386/tcg/m3b-frontend.inc';text=(source/path).read_text();old='    defuss_m3b_note(M3B_FORMED);';assert text.count(old)==1
    changes[path]=text.replace(old,old+'\n    defuss_m3co_formed(cpu_env(cpu), tb, pc, host_pc, plan.bytes);')
    path='tcg/m3b-runtime-head.inc';text=(source/path).read_text();old='static void m3b_note_tier(bool compiled)';assert text.count(old)==1
    text=text.replace(old,'#include "m3co-observer.inc"\n\n'+old)
    old='        const struct WasmTBHeader *h = ctx.tb_ptr;\n        defuss_m3b_event_pc(compiled ? M3B_COMPILED_ENTRIES : M3B_TCI_ENTRIES, pc);'
    assert text.count(old)==1;changes[path]=text.replace(old,old+'\n        m3co_enter(ctx.env, ctx.tb_ptr, compiled);')
    changes['tcg/m3co-observer.inc']=(HERE/'observer.inc').read_text();return changes
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
    report={'schema':1,'kind':'m3b-code-attribution-observation-overlay-v1','base':str(BASE),'baseFingerprint':before,'baseFiles':len(files),'source':str(output),'sourceFingerprint':after,'sourceFiles':len(new_files),'changes':changes,'sources':{str(p.relative_to(ROOT)):ident(p) for p in [Path(__file__),HERE/'observer.inc']},'timingEligible':False,'defaultEnabled':False,'runtimeValidation':'none','scope':'Fixed formation bytes and generation-specific tier observations only; no guest-memory read in execution, guard, service, cap, layout or default change.'}
    with (output.parent/'attribution-overlay.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    print(json.dumps({'status':'prepared','sourceFingerprint':after,'changes':len(changes),'files':len(new_files)}))
if __name__=='__main__':main()
