#!/usr/bin/env python3
"""Derive an RNDS2-only scalar-lane local experiment from retained source."""
import hashlib, json, os, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT/'engine/qemu'
FILE = 'tcg/wasm64/tcg-target.c.inc'

def once(text, old, new):
    assert text.count(old) == 1, old[:100]
    return text.replace(old, new)

def changed(text):
    text = once(text, '#define TMP64_LOCAL_1_IDX 3', '''#define TMP64_LOCAL_1_IDX 3

/* Pure RNDS2 scratch, declared only in TBs that emit the intrinsic. Existing
 * locals (including resume cursor 20) keep their indexes. These values are
 * initialized inside each intrinsic and never live across a helper/unwind. */
#define RNDS2_LOCAL_BASE (BLOCK_IDX + 1)
static __thread bool rnds2_lane_locals;''')
    start = text.index('static void emit_inline_rnds2_word(')
    end = text.index('\nstatic void emit_inline_rnds2_sigma', start)
    text = text[:start] + '''static void emit_inline_rnds2_word(TCGContext *s, unsigned word)
{
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, RNDS2_LOCAL_BASE + word);
}
''' + text[end:]
    start = text.index('static void emit_inline_rnds2_load(')
    end = text.index('\nstatic bool emit_inline_rnds2(', start)
    text = text[:start] + '''static void emit_inline_rnds2_load_vector(TCGContext *s, int arg_offset,
                                           const unsigned words[4])
{
    push_arg_i64(s, &arg_offset);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP64_LOCAL_0_IDX);
    for (unsigned i = 0; i < 4; i++) {
        tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP64_LOCAL_0_IDX);
        tcg_wasm_out_norm_ptr(s, 0);
        tcg_wasm_out_op_ldst(s, OPC_I32_LOAD, 0, i * 4);
        tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, RNDS2_LOCAL_BASE + words[i]);
    }
}

static void emit_inline_rnds2_dest(TCGContext *s)
{
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP64_LOCAL_0_IDX);
    tcg_wasm_out_norm_ptr(s, 0);
}
''' + text[end:]
    start = text.index('    emit_inline_rnds2_load(s, 16, 8,')
    end = text.index('    /* Round1:', start)
    text = text[:start] + '''    rnds2_lane_locals = true;
    QEMU_BUILD_BUG_ON(RNDS2_LOCAL_BASE != 21);
    /* Read both full input vectors before any destination write. */
    emit_inline_rnds2_load_vector(s, 16,
        (const unsigned[4]) { RN_F, RN_E, RN_B, RN_A });
    emit_inline_rnds2_load_vector(s, 8,
        (const unsigned[4]) { RN_H, RN_G, RN_D, RN_C });
    int dest_offset = 0;
    push_arg_i64(s, &dest_offset);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, TMP64_LOCAL_0_IDX);

    emit_inline_rnds2_t(s, RN_E, RN_F, RN_G, RN_H, 24);
    emit_inline_rnds2_aa(s, RN_A, RN_B, RN_C);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, RNDS2_LOCAL_BASE + RN_H);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP32_LOCAL_0_IDX);
    emit_inline_rnds2_word(s, RN_D);
    tcg_wasm_out_op(s, OPC_I32_ADD);
    tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, RNDS2_LOCAL_BASE + RN_D);

''' + text[end:]
    text = once(text, '    init_sub_buf();', '    rnds2_lane_locals = false;\n    init_sub_buf();')
    text = once(text, '    res = write_mod(s, mod_3, sizeof(mod_3), (FillValueU32[]) {', '''    /* Append one local group only to RNDS2-bearing TBs. Header offsets and
     * existing local/global register indexes are unchanged. */
    uint8_t lane_mod_3[sizeof(mod_3) + 2];
    const uint8_t *selected_mod_3 = mod_3;
    unsigned extra_locals_size = rnds2_lane_locals ? 2 : 0;
    if (rnds2_lane_locals) {
        memcpy(lane_mod_3, mod_3, sizeof(mod_3));
        lane_mod_3[sizeof(mod_3) - MOD_3_VARIABLES_SIZE] = 3;
        lane_mod_3[sizeof(mod_3)] = 8;
        lane_mod_3[sizeof(mod_3) + 1] = 0x7f;
        selected_mod_3 = lane_mod_3;
    }
    res = write_mod(s, selected_mod_3, sizeof(mod_3) + extra_locals_size,
                    (FillValueU32[]) {''')
    text = once(text, 'sub_buf_len() + MOD_3_CODE_SECTION_SIZE_ADD',
                'sub_buf_len() + MOD_3_CODE_SECTION_SIZE_ADD + extra_locals_size')
    text = once(text, 'sub_buf_len() + MOD_3_VARIABLES_SIZE',
                'sub_buf_len() + MOD_3_VARIABLES_SIZE + extra_locals_size')
    text = once(text, '/* No broad vector backend or local-layout change. R0/R1 have already been',
                '/* RNDS2-only local representation. R0/R1 have already been')
    a = text.index('/* Logical words retain their original names.')
    b = text.index('enum { RN_A', a)
    text = text[:a] + '''/* Eight i32 state words; after round 0 D holds EE0 and H holds AA0.
 * Generic argument placement, TCI, selection and clobbers are unchanged. */
''' + text[b:]
    return text

def ident(p):
    with p.open('rb') as f: h = hashlib.file_digest(f, 'sha256').hexdigest()
    return {'sha256':h, 'bytes':p.stat().st_size}
def inventory(root):
    files={str(p.relative_to(root)):ident(p) for p in sorted(root.rglob('*'))
           if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc'}
    h=hashlib.sha256()
    for n,v in files.items():h.update(n.encode()+b'\0');h.update(bytes.fromhex(v['sha256']))
    return h.hexdigest(),files
def save(p,obj):
    with p.open('x') as f:json.dump(obj,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    out=ROOT/'artifacts/rnds2-lanes-source-01';assert not out.exists()
    base,files=inventory(BASE);text=changed((BASE/FILE).read_text())
    out.mkdir();source=out/'source';shutil.copytree(BASE,source,symlinks=True)
    with (source/FILE).open('w') as f:f.write(text);f.flush();os.fsync(f.fileno())
    fp,final=inventory(source)
    save(out/'inventory.json',{'files':final})
    edits={n:{'before':files[n],'after':final[n]}for n in files if files[n]!=final[n]}
    assert list(edits)==[FILE]
    save(out/'overlay.json',{'status':'passed','base':'engine/qemu','source':str(source.relative_to(ROOT)),
        'baseFingerprint':base,'sourceFingerprint':fp,'changes':edits,'generator':ident(Path(__file__))})
    assert inventory(BASE)==(base,files)
    print(json.dumps({'status':'passed','sourceFingerprint':fp,'changes':list(edits)}))
if __name__=='__main__':main()
