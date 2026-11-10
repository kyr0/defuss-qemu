#!/usr/bin/env python3
"""Keep four 64-bit private-state loads while unpacking each word only once."""
import shutil
from pathlib import Path
from prepare import ROOT, BASE, FILE, changed, inventory, ident, save
def changed_v2(text):
    text=changed(text)
    a=text.index('    for (unsigned i = 0; i < 4; i++) {',text.index('static void emit_inline_rnds2_load_vector('))
    b=text.index('\n}\n\nstatic void emit_inline_rnds2_dest',a)
    text=text[:a]+'''    /* Preserve the original four i64 loads. Eight independent i32 loads
     * added four memory64 bounds/trap sites in the Node/V8 diagnostic. */
    for (unsigned i = 0; i < 4; i += 2) {
        tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP64_LOCAL_0_IDX);
        tcg_wasm_out_norm_ptr(s, 0);
        tcg_wasm_out_op_ldst(s, OPC_I64_LOAD, 0, i * 4);
        tcg_wasm_out_op_idx(s, OPC_LOCAL_TEE, TMP64_LOCAL_1_IDX);
        tcg_wasm_out_op(s, OPC_I32_WRAP_I64);
        tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, RNDS2_LOCAL_BASE + words[i]);
        tcg_wasm_out_op_idx(s, OPC_LOCAL_GET, TMP64_LOCAL_1_IDX);
        tcg_wasm_out_op_const(s, OPC_I64_CONST, 32);
        tcg_wasm_out_op(s, OPC_I64_SHR_U);
        tcg_wasm_out_op(s, OPC_I32_WRAP_I64);
        tcg_wasm_out_op_idx(s, OPC_LOCAL_SET, RNDS2_LOCAL_BASE + words[i + 1]);
    }'''+text[b:]
    return text
def main():
    out=ROOT/'artifacts/rnds2-lanes-source-02';out.mkdir()
    base,files=inventory(BASE);source=out/'source';shutil.copytree(BASE,source,symlinks=True)
    (source/FILE).write_text(changed_v2((BASE/FILE).read_text()))
    fp,final=inventory(source);save(out/'inventory.json',{'files':final})
    edits={n:{'before':files[n],'after':final[n]}for n in files if files[n]!=final[n]};assert list(edits)==[FILE]
    save(out/'overlay.json',{'status':'passed','base':'engine/qemu','baseFingerprint':base,'source':str(source.relative_to(ROOT)),'sourceFingerprint':fp,'changes':edits,
        'inputs':{str(p.relative_to(ROOT)):ident(p)for p in [Path(__file__),Path(__file__).with_name('prepare.py')]}})
    assert inventory(BASE)==(base,files);print(fp)
if __name__=='__main__':main()
