#!/usr/bin/env python3
"""Add the retained RNDS2 counters/selftests to the lane candidate, untimed."""
import shutil
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'rnds2-lanes'))
from prepare import ROOT, FILE, ident, inventory, save, once
from rnds2_candidates import COUNTERS, DIAGNOSTIC
HERE=ROOT/'experiments/rnds2-lanes'
def main():
    base=ROOT/'engine/qemu'
    out=ROOT/'artifacts/memory32-rnds2-check-source-01';out.mkdir()
    source=out/'source';shutil.copytree(base,source,symlinks=True)
    before,files=inventory(base)
    t=(base/FILE).read_text()
    t=once(t,'enum { RN_A',DIAGNOSTIC+'\nenum { RN_A')
    t=once(t,'    emit_inline_rnds2_load(s, 16, 8,', '    emit_inline_rnds2_count(s, 1);\n    emit_inline_rnds2_load(s, 16, 8,')
    t=once(t,'    int64_t func_idx = get_helper_idx(s, func);','    if (inline_rnds2_matches(func, info)) { emit_inline_rnds2_count(s, 2); }\n    int64_t func_idx = get_helper_idx(s, func);')
    t=once(t,'static void tcg_wasm_out_call(TCGContext *s, intptr_t func,',
           (HERE/'rnds2-guard-tests.c.inc').read_text()+'\nstatic void tcg_wasm_out_call(TCGContext *s, intptr_t func,')
    (source/FILE).write_text(t)
    helper='target/i386/ops_sse.h'
    anchor='void helper_sha256rnds2(Reg *d, Reg *a, Reg *b, uint32_t wk0, uint32_t wk1)\n{'
    (source/helper).write_text(once((base/helper).read_text(),anchor,anchor+'\n    bun_inline_rnds2_counts[0]++;'))
    unit='target/i386/tcg/fpu_helper.c'
    t=once((base/unit).read_text(),'#define SHIFT 0\n#include "ops_sse.h"',COUNTERS+'#define SHIFT 0\n#include "ops_sse.h"')
    for n in ['rnds2-oracle.c.inc','rnds2-helper-tests.c.inc']:t+='\n'+(HERE/n).read_text()
    (source/unit).write_text(t)
    fp,final=inventory(source);save(out/'inventory.json',{'files':final})
    save(out/'overlay.json',{'status':'passed','timingEligible':False,'baseFingerprint':before,'sourceFingerprint':fp,
        'changes':{n:{'before':files[n],'after':final[n]}for n in files if files[n]!=final[n]},
        'inputs':{str(p.relative_to(ROOT)):ident(p) for p in [Path(__file__),HERE/'rnds2_candidates.py',HERE/'rnds2-guard-tests.c.inc',HERE/'rnds2-helper-tests.c.inc',HERE/'rnds2-oracle.c.inc']}})
    print(fp)
if __name__=='__main__':main()
