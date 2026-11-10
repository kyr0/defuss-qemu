#!/usr/bin/env python3
"""Verify stopped-phase code captures and disassemble bounded x86-64 byte windows.

This creates synthetic ELF containers solely for objdump. They are not guest
ELFs, executable artifacts, or claims about the code bytes at sampling time.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess


def sha(data):
    return hashlib.sha256(data).hexdigest()


def elf_window(code, address):
    names = b'\0.text\0.shstrtab\0'
    strings = 64 + len(code)
    sections = (strings + len(names) + 7) & ~7
    ident = b'\x7fELF\x02\x01\x01' + bytes(9)
    header = struct.pack('<16sHHIQQQIHHHHHH', ident, 2, 62, 1, address,
                         0, sections, 0, 64, 0, 0, 64, 3, 2)
    sh = lambda *fields: struct.pack('<IIQQQQIIQQ', *fields)
    return (header + code + names + bytes(sections - strings - len(names)) + bytes(64)
            + sh(1, 1, 6, address, 64, len(code), 0, 0, 1, 0)
            + sh(7, 3, 0, 0, strings, len(names), 0, 0, 1, 0))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--objdump', default=shutil.which('llvm-objdump') or shutil.which('objdump'))
    args = parser.parse_args()
    raw = Path(args.report).read_bytes()
    report = json.loads(raw)
    assert report['status'] == 'passed' and report['captureCode'] is True
    assert args.objdump, 'An installed objdump is required'
    tool = Path(args.objdump).resolve()
    version = subprocess.run([str(tool), '--version'], check=True, capture_output=True, text=True).stdout
    output = Path(args.output); output.mkdir(parents=True, exist_ok=False)
    result = {'schema': 1, 'status': 'passed', 'sourceReport': str(Path(args.report).resolve()),
              'sourceReportSha256': sha(raw), 'scriptSha256': sha(Path(__file__).read_bytes()),
              'objdump': {'path': str(tool), 'sha256': sha(tool.read_bytes()), 'version': version},
              'scope': 'Stopped phase-end bytes only. Synthetic ELF preserves the requested PC and bytes for decoding; no guest symbol or code-generation identity is inferred.',
              'windows': [], 'unresolved': []}
    phases = [report['browserResult']['warmup'], *report['browserResult']['results']]
    for phase in phases:
        capture = phase['codeCapture']
        for index, row in enumerate(capture['rows']):
            identity = {'phase': phase['name'], 'sample': phase['sample'], 'pc': row['pc'], 'context': row['context']}
            if row['status'] != 'captured':
                result['unresolved'].append({**identity, 'error': row.get('error')}); continue
            code = bytes.fromhex(row['hex'])
            assert len(code) == row['bytesRequested'] and 1 <= len(code) <= 256
            assert sha(code) == row['sha256'], 'Captured code hash mismatch'
            assert b''.join(bytes.fromhex(segment['hex']) for segment in row['segments']) == code
            label = f"{phase['name']}-{phase['sample']}-{index}-{row['pc'][2:]}"
            binary, elf, disassembly = (output / (label + suffix) for suffix in ['.bin', '.elf', '.txt'])
            binary.write_bytes(code); elf.write_bytes(elf_window(code, int(row['pc'], 16)))
            command = [str(tool), '--disassemble', '--x86-asm-syntax=intel', str(elf)]
            decoded = subprocess.run(command, check=True, capture_output=True)
            disassembly.write_bytes(decoded.stdout)
            result['windows'].append({**identity, 'bytes': len(code), 'sha256': row['sha256'],
                                      'binary': binary.name, 'elf': elf.name, 'disassembly': disassembly.name,
                                      'elfSha256': sha(elf.read_bytes()), 'disassemblySha256': sha(decoded.stdout),
                                      'command': command})
    (output / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'windows': len(result['windows']), 'unresolved': len(result['unresolved']), 'output': str(output)}))


if __name__ == '__main__':
    main()
