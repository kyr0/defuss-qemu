#!/usr/bin/env python3
"""Add observation-only admission counters in a new copy of the frozen ABI2 tree."""
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
    path='target/i386/tcg/m3b-frontend.inc';text=(source/path).read_text()
    old='''    if (!tb->m3b_suppress && host_pc && defuss_m3b_can_form(tb) &&
        defuss_m3b_ram_span(host_pc, MIN(remaining, M3B_MAX_BYTES), tb_page_addr0(tb)) &&
        m3b_predecode(host_pc, MIN(remaining, M3B_MAX_BYTES), remaining,
                      *max_insns, &plan) == M3B_SHAPE_OK) {'''
    new='''    /* Evaluate the original short-circuit stages in their original order.
     * Observation counters never authorize admission or alter a guard. */
    bool m3ba_observe = defuss_m3b_profile_requested();
    bool m3ba_accept = false;
    if (m3ba_observe) { m3ba_note(16); }
    if (tb->m3b_suppress) {
        if (m3ba_observe) { m3ba_note(17); }
    } else if (!host_pc) {
        if (m3ba_observe) { m3ba_note(18); }
    } else if (!defuss_m3b_can_form(tb)) {
        if (m3ba_observe) {
            m3ba_note(19);
            m3ba_form_rejection(tb, pc);
        }
    } else if (!defuss_m3b_ram_span(host_pc, MIN(remaining, M3B_MAX_BYTES),
                                   tb_page_addr0(tb))) {
        if (m3ba_observe) { m3ba_note(20); }
    } else {
        enum m3b_predecode_result result = m3b_predecode(
            host_pc, MIN(remaining, M3B_MAX_BYTES), remaining, *max_insns, &plan);
        if (m3ba_observe) {
            m3ba_note(21);
            m3ba_decode(result, tb, pc, host_pc,
                        MIN(remaining, M3B_MAX_BYTES), *max_insns);
        }
        m3ba_accept = result == M3B_SHAPE_OK;
    }
    if (m3ba_accept) {'''
    assert text.count(old)==1,'Original admission anchor'
    text=text.replace(old,new)
    anchor='static bool m3b_match_decoded(DisasContext *s, X86DecodedInsn *d)'
    assert text.count(anchor)==1;text=text.replace(anchor,'#include "m3ba-admission.inc"\n\n'+anchor)
    return {path:text,'target/i386/tcg/m3ba-admission.inc':(HERE/'admission.inc').read_text()}
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
    report={'schema':1,'kind':'m3b-admission-observation-overlay-v1','base':str(BASE),'baseFingerprint':before,'baseFiles':len(files),'source':str(output),'sourceFingerprint':after,'sourceFiles':len(new_files),'changes':changes,'sources':{str(p.relative_to(ROOT)):ident(p) for p in [Path(__file__),HERE/'admission.inc']},'timingEligible':False,'defaultEnabled':False,'runtimeValidation':'none','scope':'Diagnostic counters and bounded last predecoder-input sample only; original admission predicate, short-circuit order, runtime guards and fallback behavior retained.'}
    with (output.parent/'admission-overlay.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    print(json.dumps({'status':'prepared','sourceFingerprint':after,'changes':len(changes),'files':len(new_files)}))
if __name__=='__main__':main()
