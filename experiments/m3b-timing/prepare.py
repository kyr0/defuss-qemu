#!/usr/bin/env python3
"""Derive an observation-free timing runtime from the accepted ABI2 tree."""
import hashlib, json, os, re, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'artifacts/m3b-context-v2-source-01/source'
OUT=ROOT/'artifacts/m3b-timing-source-01/source'
EXPECTED='46499e15df66b2f8d363d35846812bf99685ac2da44727d54494890e459ea321'
def identity(p):
    b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def inventory(p):
    files={str(x.relative_to(p)):identity(x) for x in sorted(p.rglob('*')) if x.is_file() and '__pycache__' not in x.parts and x.suffix!='.pyc'}
    h=hashlib.sha256()
    for n,i in files.items():h.update(n.encode()+b'\0');h.update(bytes.fromhex(i['sha256']))
    return h.hexdigest(),files
def write(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True)
    b=(json.dumps(obj,indent=2)+'\n').encode() if not isinstance(obj,str) else obj.encode()
    with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
def function(text,name):
    match=re.search(r'(?m)^(?:EMSCRIPTEN_KEEPALIVE )?(?:static (?:inline )?)?(?:void|bool|int|unsigned|uint64_t|uintptr_t) '+name+r'\([^;]*?\)\s*\{',text)
    assert match,name
    start=match.start();begin=match.end()-1;depth=1;end=begin+1
    while depth:
        if text[end]=='{':depth+=1
        elif text[end]=='}':depth-=1
        end+=1
    return start,end,text[start:end]
def replace_fn(text,name,replacement):
    a,b,_=function(text,name);return text[:a]+replacement+text[b:]
def once(text,a,b):assert text.count(a)==1,a;return text.replace(a,b)
def derive():
    changes={}
    name='tcg/wasm64.h';t=(BASE/name).read_text()
    t=once(t,'void defuss_m3b_note(unsigned index);','static inline void defuss_m3b_note(unsigned index) {}')
    t=once(t,'void defuss_m3b_event_pc(unsigned index, uint64_t pc);','static inline void defuss_m3b_event_pc(unsigned index, uint64_t pc) {}');changes[name]=t
    name='tcg/m3-region-adapter.inc';t=(BASE/name).read_text()
    t=replace_fn(t,'m3_add','static inline void m3_add(unsigned index, uint32_t count) {}')
    t=replace_fn(t,'m3_watch_entry','static inline void m3_watch_entry(CPUArchState *env, const struct m3_descriptor *d) {}')
    for fn in ['defuss_m3_abi','defuss_m3_data','defuss_m3_watch']:
        t=replace_fn(t,fn,'');t=re.sub(r'EMSCRIPTEN_KEEPALIVE [^;\n]*\b'+fn+r'\([^;]*;\n','',t)
    t=once(t,'#include "m3-region-test.inc"','/* Timing build: no diagnostic injection API. */')
    changes[name]=t
    name='tcg/m3b-runtime-head.inc';t=(BASE/name).read_text()
    start=t.index('static uint32_t m3b_words[');end=t.index('static uint64_t m3b_runtime_pc')
    t=t[:start]+t[end:]
    t=replace_fn(t,'defuss_m3b_data','');t=re.sub(r'EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3b_data\(void\);\n','',t)
    t=replace_fn(t,'m3b_note_tier','static inline void m3b_note_tier(bool compiled) {}')
    t=once(t,'#include "m3b-runtime-boundary.inc"','''/* All diagnostic boundary hooks compile away. Native B polling is retained. */
static inline void m3b_boundary_entry(CPUArchState *env) {}
static inline unsigned m3b_boundary_before(CPUArchState *env, const void *code, bool compiled) { return 0; }
static inline void m3b_boundary_after(CPUArchState *env, uintptr_t result, unsigned token) {}
static inline void m3b_boundary_complete(CPUArchState *env, unsigned token) {}''')
    t=once(t,'#include "m3cc-adapter.inc"','static inline void m3cc_lock(void) {}')
    changes[name]=t
    name='tcg/wasm64.c';t=(BASE/name).read_text();t=once(t,'static void m3cc_note(CPUArchState *, void *, unsigned);','static inline void m3cc_note(CPUArchState *env, void *code, unsigned tier) {}');changes[name]=t
    name='target/i386/tcg/m3b-frontend.inc';t=(BASE/name).read_text()
    t=once(t,'    TCGLabel *forced = gen_new_label();\n','')
    start=t.index('    /* Separate, default-disarmed diagnostic selector.')
    end=t.index('    tcg_gen_ld_i32(pending, tcg_env,\n                  offsetof(CPUState, neg.icount_decr.u32)',start)
    t=t[:start]+t[end:]
    t=once(t,'    gen_set_label(forced);\n    tcg_gen_st_i32(tcg_constant_i32(2), tcg_env,\n                  offsetof(CPUX86State, m3b_boundary_force));\n','')
    changes[name]=t
    return changes
if __name__=='__main__':
    assert not OUT.exists();fp,files=inventory(BASE);assert fp==EXPECTED
    changes=derive()
    # Guard and debt/service implementation must be byte-identical; only observations disappear.
    preserved={}
    for name,functions in {'tcg/m3b-runtime-head.inc':['m3b_worker_eligible','defuss_m3b_can_form','m3b_entry_valid','m3b_tci_closing_slot','m3b_call_wasm_tb'],'tcg/m3-region-adapter.inc':['m3_next_generation','defuss_m3_publish','defuss_m3_invalidated','m3_call_wasm_tb']}.items():
        for fn in functions:
            old=function((BASE/name).read_text(),fn)[2];assert old==function(changes[name],fn)[2];preserved[fn]=hashlib.sha256(old.encode()).hexdigest()
    OUT.parent.mkdir(parents=True);shutil.copytree(BASE,OUT,symlinks=True)
    assert inventory(OUT)==(fp,files)
    for name,t in changes.items():
        with (OUT/name).open('w') as f:f.write(t);f.flush();os.fsync(f.fileno())
    after,newfiles=inventory(OUT);assert inventory(BASE)==(fp,files)
    changed=[n for n in newfiles if files[n]!=newfiles[n]];assert sorted(changed)==sorted(changes)
    assert (OUT/'tcg/m3b-runtime-service.inc').read_bytes()==(BASE/'tcg/m3b-runtime-service.inc').read_bytes()
    report={'schema':1,'status':'passed','kind':'m3b-uninstrumented-timing-derivation-v1','base':str(BASE.relative_to(ROOT)),'baseFingerprint':fp,'source':str(OUT.relative_to(ROOT)),'sourceFingerprint':after,'changes':{n:{'before':files[n],'after':newfiles[n]} for n in changed},'preservedFunctions':preserved,'serviceByteIdentical':True,'layoutUnchanged':True,'profileGuardsUnchanged':True,'defaultEnabled':False,'promotionEligible':False,'generator':identity(Path(__file__))}
    write(OUT.parent/'overlay.json',report);write(OUT.parent/'inventory.json',{'files':newfiles,'links':{str(p.relative_to(OUT)):os.readlink(p) for p in OUT.rglob('*') if p.is_symlink()}})
    print(json.dumps({'status':'passed','sourceFingerprint':after,'changedFiles':changed}))
