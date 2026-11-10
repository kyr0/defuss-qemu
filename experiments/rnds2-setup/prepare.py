#!/usr/bin/env python3
"""Apply the narrow SIMD operand forwarding experiment to retained RNDS2 source."""
import hashlib, json, os, shutil
from pathlib import Path
from setup_candidates import changes

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'engine/qemu'

def identity(path):
    data = path.read_bytes()
    return {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}

def inventory(root):
    files = {str(p.relative_to(root)): identity(p) for p in sorted(root.rglob('*'))
             if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc'}
    digest = hashlib.sha256()
    for name, item in files.items():
        digest.update(name.encode() + b'\0')
        digest.update(bytes.fromhex(item['sha256']))
    return digest.hexdigest(), files

def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2); stream.write('\n')
        stream.flush(); os.fsync(stream.fileno())

if __name__ == '__main__':
    before, files = inventory(BASE)
    assert 'static void emit_inline_rnds2_word' in (BASE/'tcg/wasm64/tcg-target.c.inc').read_text()
    for kind in ['setup', 'setup-check']:
        out = ROOT / f'artifacts/rnds2-{kind}-source-01'
        assert not out.exists(), out
        edits = changes(kind, BASE)
        out.mkdir()
        source = out/'source'
        shutil.copytree(BASE, source, symlinks=True)
        for name, text in edits.items():
            with (source/name).open('w') as stream:
                stream.write(text); stream.flush(); os.fsync(stream.fileno())
        after, final = inventory(source)
        changed = {n: {'before': files[n], 'after': final[n]}
                   for n in final if files[n] != final[n]}
        save(out/'inventory.json', {'files': final})
        save(out/'overlay.json', {
            'status':'passed', 'kind':kind, 'base':'engine/qemu',
            'baseFingerprint':before, 'source':str(source.relative_to(ROOT)),
            'sourceFingerprint':after, 'changes':changed,
            'generator':identity(Path(__file__)),
            'portedGenerator':identity(Path(__file__).with_name('setup_candidates.py')),
            'scope':'RNDS2 plus early SIMD operand forwarding; no M2/M3 code; no performance claim'})
        print(json.dumps({'kind':kind, 'sourceFingerprint':after, 'changedFiles':list(changed)}))
    assert inventory(BASE) == (before, files)
