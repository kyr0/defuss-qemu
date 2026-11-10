#!/usr/bin/env python3
"""Compile the actual two emitters with a byte sink; no recreated RNDS2 math."""
import json, subprocess
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'rnds2-lanes'))
from prepare import ROOT, BASE, FILE, ident, save
OUT=ROOT/'artifacts/memory32-rnds2-emitter-01'
def between(t,a,b):return t[t.index(a):t.index(b,t.index(a))]
def main():
    OUT.mkdir()
    inputs={}
    for kind,source in [('original',BASE),('candidate',BASE)]:
        p=source/FILE;t=p.read_text();inputs[str(p.relative_to(ROOT))]=ident(p)
        code='''#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <assert.h>
#include <inttypes.h>
typedef struct { unsigned count; } TCGContext;
typedef struct { int unused; } TCGHelperInfo;
#define REG_LOCAL_BASE 4
#define REG_IDX(r) (4+(r))
#define TCG_REG_R0 0
#define TCG_REG_R1 1
#define TCG_REG_CALL_STACK 15
#define TMP32_LOCAL_0_IDX 1
#define TMP64_LOCAL_0_IDX 2
#define TMP64_LOCAL_1_IDX 3
#define RNDS2_LOCAL_BASE 21
#define tcg_debug_assert(x) ((void)0)
#define QEMU_BUILD_BUG_ON(x) _Static_assert(!(x), #x)
static bool rnds2_lane_locals;
static bool inline_rnds2_matches(intptr_t f,const TCGHelperInfo*i){return true;}
static void byte(unsigned b){putchar(b&255);}
static void uleb(uint64_t n){do{unsigned b=n&127;n>>=7;byte(b|(n?128:0));}while(n);}
static void sleb(int64_t n){for(;;){unsigned b=n&127;n>>=7;bool end=(n==0&&!(b&64))||(n==-1&&(b&64));byte(b|(end?0:128));if(end)break;}}
static void tcg_wasm_out_op(TCGContext*s,unsigned op){byte(op);s->count++;}
static void tcg_wasm_out_op_idx(TCGContext*s,unsigned op,unsigned idx){tcg_wasm_out_op(s,op);uleb(idx);}
static void tcg_wasm_out_op_const(TCGContext*s,unsigned op,int64_t n){tcg_wasm_out_op(s,op);sleb(n);}
static void tcg_wasm_out_op_ldst(TCGContext*s,unsigned op,unsigned a,uint64_t o){tcg_wasm_out_op(s,op);uleb(a);uleb(o);}
static intptr_t tcg_wasm_out_norm_ptr(TCGContext*s,intptr_t o);
'''
        code+=between(t,'typedef enum {\n    OPC_UNREACHABLE','typedef enum {\n    BLOCK_NORET')
        code+=between(t,'static intptr_t tcg_wasm_out_norm_ptr(', 'static void tcg_wasm_out_ld(')
        code+=between(t,'static void push_arg_i64(', 'static void tcg_wasm_out_handle_unwinding(')
        code+=between(t,'static void emit_xmm_ptr(', 'static void emit_v128_mem(')
        code+=between(t,'enum { RN_A','static void tcg_wasm_out_call(')
        code+='\nint main(void){TCGContext s={0};TCGHelperInfo info={0};assert(emit_inline_rnds2(&s,0,&info));fprintf(stderr,"%u\\n",s.count);return 0;}\n'
        c=OUT/(kind+'.c');c.write_text(code);exe=OUT/kind
        compile=subprocess.run(['/usr/bin/clang','-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk','-std=c11','-O2',*(['-DWASM64_MEMORY64_2']if kind=='candidate'else []),str(c),'-o',str(exe)],capture_output=True,text=True)
        (OUT/(kind+'-compile.log')).write_text(compile.stdout+compile.stderr);assert compile.returncode==0
        result=subprocess.run([str(exe)],capture_output=True,check=True)
        (OUT/(kind+'.body')).write_bytes(result.stdout)
        save(OUT/(kind+'.json'),{'status':'passed','emittedInstructions':int(result.stderr),'body':ident(OUT/(kind+'.body')),'source':ident(p),'driver':ident(c),'scope':'Exact intrinsic body, selector stubbed true; actual pointer normalization; memory64/original versus memory32/candidate'})
    inputs[str(Path(__file__).relative_to(ROOT))]=ident(Path(__file__))
    save(OUT/'inputs.json',inputs)
if __name__=='__main__':main()
