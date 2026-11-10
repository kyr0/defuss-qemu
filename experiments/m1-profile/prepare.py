#!/usr/bin/env python3
"""Materialize an isolated M1 diagnostic source tree; never edit the baseline."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise RuntimeError(f"Source anchor mismatch ({text.count(old)} != {count}): {old[:120]}")
    return text.replace(old, new)


def patch_files(source):
    outputs = {}
    path = Path("tcg/wasm64.h")
    text = (source / path).read_text()
    text = replace(text, "struct WasmTBHeader {\n", "struct WasmTBHeader {\n"
                   "    /* M1 diagnostic identity, copied before publishing the TB. */\n"
                   "    uint64_t m1_pc;\n    uint32_t m1_flags, m1_cflags;\n")
    outputs[path] = text

    path = Path("tcg/tcg.c")
    text = (source / path).read_text()
    text = replace(text, "    tcg_out_tb_start(s);\n", "    tcg_out_tb_start(s);\n"
                   "#ifdef __EMSCRIPTEN__\n"
                   "    struct WasmTBHeader *m1_header = (struct WasmTBHeader *)s->code_buf;\n"
                   "    m1_header->m1_pc = pc_start;\n"
                   "    m1_header->m1_flags = tb->flags;\n"
                   "    m1_header->m1_cflags = tb->cflags;\n"
                   "#endif\n")
    outputs[path] = text

    path = Path("tcg/wasm64.c")
    text = (source / path).read_text()
    text = replace(text, "static __thread int thread_idx;\n",
                   'static __thread int thread_idx;\n#include "m1-profile-adapter.inc"\n')
    text = replace(text, "static inline bool inc_counter(void *tb_ptr, bool *held)",
                   "static inline bool inc_counter_base(void *tb_ptr, bool *held)")
    text = replace(text, "static __thread struct WasmContext ctx = {", """static inline bool inc_counter(void *tb_ptr, bool *held)
{
    if (!m1_active()) { return inc_counter_base(tb_ptr, held); }
    int32_t before = get_counter_local(tb_ptr);
    bool result = inc_counter_base(tb_ptr, held);
    m1_inc(&m1_profile, M1_ADMISSION_CALLS);
    m1_inc(&m1_profile, result ? M1_ADMISSION_READY :
           before >= INSTANTIATE_NUM ? M1_ADMISSION_HELD : M1_ADMISSION_COLD);
    return result;
}

static __thread struct WasmContext ctx = {""")
    text = replace(text, "    uint32_t *tb_ptr = get_tci_ptr(ctx.tb_ptr);",
                   "    m1_note_entry(env, ctx.tb_ptr, M1_INTERPRETED);\n"
                   "    uint32_t *tb_ptr = get_tci_ptr(ctx.tb_ptr);")
    text = replace(text, "                    return 0; /* enter to wasm TB */",
                   "                    m1_note(M1_TCI_TO_DISPATCHER);\n"
                   "                    return 0; /* enter to wasm TB */")
    text = replace(text, "                return 0; /* enter to wasm TB */\n            }\n            tb_ptr = get_tci_ptr(tb_ptr);",
                   "                m1_note(M1_TCI_TO_DISPATCHER);\n"
                   "                return 0; /* enter to wasm TB */\n            }\n"
                   "            m1_note(M1_INTERPRETED_CHAINS);\n"
                   "            m1_note_entry(env, tb_ptr, M1_INTERPRETED);\n"
                   "            tb_ptr = get_tci_ptr(tb_ptr);")
    text = replace(text, "                tb_ptr = get_tci_ptr(tb_ptr);\n            }\n            break;",
                   "                m1_note(M1_INTERPRETED_CHAINS);\n"
                   "                m1_note_entry(env, tb_ptr, M1_INTERPRETED);\n"
                   "                tb_ptr = get_tci_ptr(tb_ptr);\n            }\n            break;")
    text = replace(text, "    if (elm->tb_ptr != tb_ptr) {",
                   "    if (elm->tb_ptr != tb_ptr) {\n        m1_note(M1_STALE_INSTANCE_MISSES);")
    text = replace(text, "    ctx.env = env;\n    ctx.tb_ptr = (void *)v_tb_ptr;",
                   "    if (m1_active()) { m1_chain_start(&m1_profile); }\n"
                   "    ctx.env = env;\n    ctx.tb_ptr = (void *)v_tb_ptr;")
    text = replace(text, "        wasm_tb_func tb_func = get_instance_from_tb(ctx.tb_ptr);",
                   "        m1_note(M1_DISPATCH_ITERATIONS);\n"
                   "        wasm_tb_func tb_func = get_instance_from_tb(ctx.tb_ptr);")
    text = replace(text, "            res = call_wasm_tb(tb_func, &ctx);",
                   "            m1_note_entry(env, ctx.tb_ptr, M1_COMPILED);\n"
                   "            res = call_wasm_tb(tb_func, &ctx);", count=2)
    text = replace(text, "            return wasm44_retier(env, ctx.tb_ptr);",
                   "            m1_note(M1_RETIER_RETURNS);\n"
                   "            return wasm44_retier(env, ctx.tb_ptr);")
    text = replace(text, "        } else if (!reserve_instance()) {",
                   "        } else if (!reserve_instance()) {\n"
                   "            m1_note(M1_INSTANCE_BUDGET_REJECTS);")
    text = replace(text, "            add_instance(tb_func, ctx.tb_ptr);",
                   "            add_instance(tb_func, ctx.tb_ptr);\n"
                   "            m1_note(M1_INSTANCE_INSTALLS);")
    text = replace(text, "        if (!ctx.tb_ptr) {\n            return res;",
                   "        if (!ctx.tb_ptr) {\n            m1_note(M1_DISPATCH_RETURNS);\n            return res;")
    outputs[path] = text

    path = Path("target/i386/tcg/system/seg_helper.c")
    text = (source / path).read_text()
    text = replace(text, "void helper_syscall(CPUX86State *env, int next_eip_addend)\n",
                   "#ifdef __EMSCRIPTEN__\n"
                   "void defuss_m1_syscall(uint64_t number, unsigned valid64user);\n"
                   "#endif\n\n"
                   "void helper_syscall(CPUX86State *env, int next_eip_addend)\n")
    text = replace(text, "    selector = (env->star >> 32) & 0xffff;",
                   "#ifdef __EMSCRIPTEN__\n"
                   "    /* Entry attempt after the SCE check, before the privilege transition.\n"
                   "     * This does not identify Linux or record syscall completion. */\n"
                   "    defuss_m1_syscall(env->regs[R_EAX],\n"
                   "        (env->hflags & (HF_LMA_MASK | HF_CS64_MASK | HF_CPL_MASK)) ==\n"
                   "        (HF_LMA_MASK | HF_CS64_MASK | 3));\n"
                   "#endif\n"
                   "    selector = (env->star >> 32) & 0xffff;")
    outputs[path] = text
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=PROJECT / "engine/qemu")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true", help="Validate anchors only; write nothing")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    patched = patch_files(source)  # Validate all anchors before writing anything.
    if args.check:
        print(json.dumps({"anchors": "pass", "files": list(map(str, patched))}, indent=2))
        return
    if output == source or output in source.parents or source in output.parents:
        raise SystemExit("Output must be a separate tree outside the input source")
    if output.exists():
        raise SystemExit("Output already exists; choose a fresh output path")
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, output, symlinks=True)
    changes = []
    for path, text in patched.items():
        (output / path).write_text(text)
        changes.append({"path": str(path), "before": sha(source / path), "after": sha(output / path)})
    for original, target in [("m1-profile-core.h", "tcg/m1-profile-core.h"),
                             ("adapter.inc", "tcg/m1-profile-adapter.inc")]:
        shutil.copyfile(HERE / original, output / target)
        changes.append({"path": target, "before": None, "after": sha(output / target)})
    manifest = {"schema": 1, "kind": "diagnostic-only", "source": str(source),
                "output": str(output), "changes": changes,
                "generatorSha256": sha(Path(__file__)),
                "profileAbi": 1, "pcAddressingRevision": 1,
                "defaultEnabled": False, "validatedGuest": "none"}
    manifest_path = output.parent / (output.name + "-m1-overlay.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"source": str(output), "manifest": str(manifest_path)}, indent=2))


if __name__ == "__main__":
    main()
