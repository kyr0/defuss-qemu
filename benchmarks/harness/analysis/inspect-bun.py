#!/usr/bin/env python3
"""Inspect file-backed Bun PCs using an exact distroless archive and maps capture.

Example (creates a fresh output directory and extracts the 107 MB Bun executable):
  python3 benchmarks/harness/analysis/inspect-bun.py \
    --tar assets/bun/amd64/distroless.tar --maps artifacts/RUN/post-warmup.maps \
    --pc 0x123456 0x234567 --output artifacts/bun-pc-inspection-01

--pcs-json also accepts a JSON array of address strings, or objects with an
address or pc field. Supply the analyzer's selected file-backed rows as that
array; unrelated/anonymous addresses remain unknown. No guest is started.
"""

import argparse
import bisect
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tarfile


MEMBER = 'usr/local/bin/bun'
GUEST_PATH = '/' + MEMBER
U64 = 1 << 64
MAPS_LIMIT = 2 * 1024 * 1024
METADATA_LIMIT = 32 * 1024 * 1024
PC_LIMIT = 256
MAP_RE = re.compile(r'^([0-9a-fA-F]+)-([0-9a-fA-F]+) ([r-][w-][x-][ps]) '
                    r'([0-9a-fA-F]+) ([0-9a-fA-F]+):([0-9a-fA-F]+) (\d+)\s*(.*)$')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def parse_pc(value):
    require(isinstance(value, str) and re.fullmatch(r'(?:0[xX][0-9a-fA-F]+|[0-9]+)', value),
            'PC must be an unsigned decimal or 0x-prefixed hexadecimal string')
    pc = int(value, 16 if value.lower().startswith('0x') else 10)
    require(0 <= pc < U64, 'PC exceeds u64')
    return pc


def parse_maps(raw):
    require(len(raw.encode('utf-8')) <= MAPS_LIMIT, 'Maps text exceeds 2 MiB')
    rows = []
    for number, line in enumerate(raw.splitlines(), 1):
        if not line:
            continue
        match = MAP_RE.fullmatch(line)
        require(match is not None, f'Malformed maps line {number}')
        start, end = int(match[1], 16), int(match[2], 16)
        offset, inode = int(match[4], 16), int(match[7])
        require(0 <= start < end <= U64 and offset < U64 and inode < U64,
                f'Maps range/identity exceeds u64 at line {number}')
        require(not rows or start >= rows[-1]['end'], 'Unordered or overlapping maps')
        rows.append({'start': start, 'end': end, 'offset': offset,
                     'permissions': match[3], 'device': f'{match[5]}:{match[6]}',
                     'inode': inode, 'path': match[8], 'lineNumber': number, 'raw': line})
    require(rows, 'Empty maps capture')
    return rows


def public_map(row):
    return {**row, 'start': hex(row['start']), 'end': hex(row['end']),
            'offset': hex(row['offset']), 'inode': str(row['inode'])}


class ELF:
    """Bounded ELF64 little-endian parser; no debug format or demangler dependency."""

    def __init__(self, stream, size):
        self.stream, self.size = stream, size
        self.notes = []
        header = struct.unpack('<16sHHIQQQIHHHHHH', self.read(0, 64))
        ident, self.kind, self.machine, version, self.entry, phoff, shoff, _, ehsize, phsize, phnum, shsize, shnum, shstrings = header
        require(ident[:7] == b'\x7fELF\x02\x01\x01' and version == 1 and ehsize >= 64,
                'Expected ELF64 little-endian version 1')
        require(self.kind in (2, 3), 'Only ET_EXEC and ET_DYN executables are supported')
        require(self.machine == 62, 'This inspector currently supports x86_64 Bun only')
        require(0 < phnum < 0xffff and phsize >= 56, 'Missing/extended program headers unsupported')
        raw = self.read(phoff, phsize * phnum)
        self.programs = []
        for index in range(phnum):
            kind, flags, off, va, _, filesz, memsz, align = struct.unpack_from('<IIQQQQQQ', raw, index * phsize)
            require(off <= size and filesz <= size - off, 'Program file range exceeds member')
            require(va < U64 and memsz <= U64 - va, 'Program virtual range exceeds u64')
            if kind == 1:
                require(memsz >= filesz, 'PT_LOAD memsz is smaller than filesz')
                require(align in (0, 1) or (align & (align - 1) == 0 and va % align == off % align),
                        'Invalid PT_LOAD alignment')
            self.programs.append({'index': index, 'type': kind, 'flags': flags,
                                  'offset': off, 'vaddr': va, 'filesz': filesz,
                                  'memsz': memsz, 'align': align})
        self.loads = [item for item in self.programs if item['type'] == 1]
        require(self.loads, 'ELF has no PT_LOAD segments')
        self.sections = []
        if shoff or shnum:
            require(shoff and 0 < shnum < 0xffff and shsize >= 64 and shstrings < shnum,
                    'Extended/malformed section headers unsupported')
            raw = self.read(shoff, shsize * shnum)
            for index in range(shnum):
                name, kind, flags, addr, off, count, link, info, align, entsize = struct.unpack_from('<IIQQQQIIQQ', raw, index * shsize)
                require(kind == 8 or (off <= size and count <= size - off), 'Section range exceeds member')
                self.sections.append({'index': index, 'nameOffset': name, 'type': kind,
                                      'flags': flags, 'addr': addr, 'offset': off, 'size': count,
                                      'link': link, 'info': info, 'align': align, 'entsize': entsize})
            strings = self.sections[shstrings]
            require(strings['type'] in (0, 3), 'Invalid section-name string table')
            names = self.read(strings['offset'], strings['size'])
            for section in self.sections:
                section['name'] = self.string(names, section['nameOffset'])
        self.build_ids = self.read_build_ids()
        self.symbols, self.symbol_tables = self.read_symbols()

    def read(self, offset, count):
        require(0 <= offset <= self.size and 0 <= count <= self.size - offset,
                'ELF read exceeds member bounds')
        require(count <= METADATA_LIMIT, 'ELF metadata read exceeds 32 MiB bound')
        self.stream.seek(offset)
        data = self.stream.read(count)
        require(len(data) == count, 'Short ELF read')
        return data

    @staticmethod
    def string(data, offset):
        if not data and offset == 0:
            return ''
        require(0 <= offset < len(data), 'String offset exceeds table')
        end = data.find(b'\0', offset)
        require(end >= 0, 'Unterminated ELF string')
        require(end - offset <= 16384, 'ELF symbol/section name exceeds bound')
        return data[offset:end].decode('utf-8', errors='replace')

    def read_build_ids(self):
        ranges = {(p['offset'], p['filesz']) for p in self.programs if p['type'] == 4}
        ranges.update((s['offset'], s['size']) for s in self.sections if s['type'] == 7)
        ids = set()
        for offset, count in sorted(ranges):
            require(count <= 1024 * 1024, 'ELF notes exceed 1 MiB bound')
            data, cursor = self.read(offset, count), 0
            while cursor < len(data):
                if len(data) - cursor < 12 and not any(data[cursor:]):
                    break
                require(len(data) - cursor >= 12, 'Truncated ELF note')
                namesz, descsz, kind = struct.unpack_from('<III', data, cursor)
                cursor += 12
                name_end = cursor + namesz
                desc_start = cursor + ((namesz + 3) & ~3)
                desc_end = desc_start + descsz
                next_cursor = desc_start + ((descsz + 3) & ~3)
                require(next_cursor <= len(data), 'ELF note exceeds note range')
                if kind == 3 and data[cursor:name_end] == b'GNU\0':
                    require(0 < descsz <= 128, 'Invalid GNU build-id length')
                    ids.add(data[desc_start:desc_end].hex())
                cursor = next_cursor
        require(len(ids) <= 1, 'Conflicting GNU build IDs')
        return sorted(ids)

    def read_symbols(self):
        symbols, tables = {}, []
        for section in self.sections:
            if section['type'] not in (2, 11):
                continue
            require(section['entsize'] >= 24 and section['size'] % section['entsize'] == 0,
                    'Invalid symbol entry size')
            require(section['link'] < len(self.sections), 'Invalid symbol string-table link')
            strings = self.sections[section['link']]
            require(strings['type'] == 3, 'Symbols do not link to a string table')
            raw = self.read(section['offset'], section['size'])
            names = self.read(strings['offset'], strings['size'])
            count, defined, functions = len(raw) // section['entsize'], 0, 0
            for index in range(count):
                name, info, other, shindex, value, size = struct.unpack_from('<IBBHQQ', raw, index * section['entsize'])
                defined += bool(shindex)
                if not shindex or (info & 15) not in (2, 10):
                    continue
                if not any(p['flags'] & 1 and p['vaddr'] <= value < p['vaddr'] + p['filesz'] for p in self.loads):
                    continue
                text = self.string(names, name)
                if not text:
                    continue
                functions += 1
                key = (value, size, text)
                if key not in symbols:
                    symbols[key] = {'value': value, 'size': size, 'name': text,
                                    'type': 'GNU_IFUNC' if info & 15 == 10 else 'FUNC',
                                    'binding': info >> 4, 'visibility': other & 3, 'tables': []}
                symbols[key]['tables'].append(section['name'])
            tables.append({'name': section['name'], 'entries': count, 'defined': defined,
                           'executableFunctionEntries': functions})
        return sorted(symbols.values(), key=lambda s: (s['value'], s['name'])), tables

    def metadata(self):
        return {'class': 'ELF64', 'endianness': 'little', 'machine': 'x86_64',
                'type': 'ET_EXEC' if self.kind == 2 else 'ET_DYN', 'entry': hex(self.entry),
                'gnuBuildId': self.build_ids[0] if self.build_ids else None,
                'loadSegments': [public_segment(s) for s in self.loads],
                'symbolTables': self.symbol_tables, 'uniqueExecutableFunctionSymbols': len(self.symbols),
                'debugSections': [s['name'] for s in self.sections if 'debug' in s['name']],
                'notes': ['ET_DYN relocation/ASLR is derived from the supplied map and selected PT_LOAD.',
                          'ET_EXEC normally has zero load bias; any observed nonzero bias is reported, not hidden.',
                          'Sparse exported symbols are context only and do not establish algorithm or function identity.']}


def public_segment(segment):
    return {key: hex(value) if key in ('offset', 'vaddr', 'filesz', 'memsz', 'align') else value
            for key, value in segment.items()}


def inspect_pc(pc, maps, elf, before=64, after=128):
    result = {'pc': hex(pc), 'status': 'unknown', 'algorithmIdentity': 'unknown'}
    rows = [row for row in maps if row['start'] <= pc < row['end']]
    if not rows:
        return {**result, 'reason': 'unmapped-at-capture'}
    row = rows[0]
    result['mapping'] = public_map(row)
    if 'x' not in row['permissions']:
        return {**result, 'reason': 'not-executable-at-capture'}
    if not row['path']:
        return {**result, 'reason': 'anonymous-executable-jit-unknown'}
    if row['path'].startswith('['):
        return {**result, 'reason': 'special-executable-unknown'}
    if row['path'] != GUEST_PATH or not row['inode']:
        return {**result, 'reason': 'file-identity-does-not-match-exact-archive-member'}
    offset = row['offset'] + pc - row['start']
    result['mappedFileOffset'] = hex(offset)
    matches = [p for p in elf.loads if p['flags'] & 1 and p['offset'] <= offset < p['offset'] + p['filesz']]
    if len(matches) != 1:
        return {**result, 'reason': 'ambiguous-executable-PT_LOAD' if matches else 'outside-executable-file-bytes'}
    segment = matches[0]
    va = segment['vaddr'] + offset - segment['offset']
    result.update(status='mapped-file-bytes', elfVirtualAddress=hex(va),
                  loadBias=hex(pc - va), segment=public_segment(segment),
                  identityBasis='Exact map pathname and PT_LOAD file offset; campaign rootfs provenance must establish archive identity.')
    symbols = [s for s in elf.symbols if segment['vaddr'] <= s['value'] < segment['vaddr'] + segment['filesz']]
    index = bisect.bisect_right([s['value'] for s in symbols], va)
    def symbol_context(symbol):
        if symbol is None:
            return None
        return {**symbol, 'value': hex(symbol['value']), 'size': hex(symbol['size']),
                'pcMinusSymbolValue': va - symbol['value'],
                'withinDeclaredExtent': symbol['value'] <= va < symbol['value'] + symbol['size']}
    result['nearestSymbols'] = {'preceding': symbol_context(symbols[index - 1] if index else None),
                                'following': symbol_context(symbols[index] if index < len(symbols) else None),
                                'interpretation': 'Nearest sparse symbol context is not proof of containing function or algorithm.'}
    start = max(segment['offset'], offset - before)
    stop = min(segment['offset'] + segment['filesz'], offset + after)
    result['byteWindow'] = {'fileOffset': hex(start), 'pcOffsetWithinWindow': offset - start,
                            'bytes': stop - start, 'hex': elf.read(start, stop - start).hex()}
    result['disassemblyWindow'] = {'startElfVA': hex(va), 'stopElfVA': hex(va + stop - offset),
                                   'interpretation': 'Decoding starts at requested PC, which must be an instruction boundary. Preceding bytes are raw context only.'}
    return result


def extract_member(archive, output):
    """Copy one exact regular member, without tar path extraction or overwrites."""
    with archive.open('rb') as source:
        before = os.fstat(source.fileno())
        archive_hash = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b''):
            archive_hash.update(block)
        source.seek(0)
        with tarfile.open(fileobj=source, mode='r:*') as tar:
            member = None
            for count, candidate in enumerate(tar, 1):
                require(count <= 100000, 'Archive member count exceeds bound')
                if candidate.name == MEMBER:
                    require(member is None, 'Archive has duplicate Bun member names')
                    member = candidate
            require(member is not None and member.isfile() and not member.issparse(),
                    'Exact Bun member must be a nonsparse regular file')
            require(64 <= member.size <= 1024 * 1024 * 1024, 'Bun member size exceeds supported bounds')
            digest, copied = hashlib.sha256(), 0
            with tar.extractfile(member) as stream, output.open('xb') as target:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    copied += len(block)
                    require(copied <= member.size, 'Member data exceeds declared length')
                    digest.update(block)
                    target.write(block)
            require(copied == member.size, 'Short Bun archive member')
        after = os.fstat(source.fileno())
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        require(identity(before) == identity(after), 'Archive changed while reading')
    return {'archivePath': str(archive), 'archiveBytes': before.st_size,
            'archiveSha256': archive_hash.hexdigest(), 'member': MEMBER,
            'memberBytes': copied, 'memberSha256': digest.hexdigest(),
            'memberType': 'regular', 'extractedArtifact': output.name}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--tar', type=Path, required=True, help='Exact distroless archive used for the guest')
    parser.add_argument('--maps', type=Path, required=True, help='Exact /proc/<pid>/maps capture matching the PCs')
    parser.add_argument('--pc', nargs='+', action='extend', default=[])
    parser.add_argument('--pcs-json', type=Path, help='Array of PC strings or objects with address/pc fields')
    parser.add_argument('--output', type=Path, required=True, help='Fresh directory; never overwritten')
    parser.add_argument('--before', type=int, default=64, help='Raw context bytes before PC (not disassembled)')
    parser.add_argument('--after', type=int, default=128, help='Forward disassembly bytes starting at PC')
    parser.add_argument('--objdump', help='Local LLVM/GNU objdump executable')
    args = parser.parse_args(argv)
    try:
        require(0 <= args.before <= 4096 and 1 <= args.after <= 4096 and args.before + args.after <= 4096,
                'Byte window must be positive and at most 4096 bytes total')
        values = list(args.pc)
        if args.pcs_json:
            require(args.pcs_json.stat().st_size <= MAPS_LIMIT, 'PC JSON exceeds 2 MiB')
            selected = json.loads(args.pcs_json.read_text())
            require(isinstance(selected, list), 'PC JSON must be an array')
            for value in selected:
                if isinstance(value, dict):
                    address, pc = value.get('address'), value.get('pc')
                    require(address is None or pc is None or parse_pc(address) == parse_pc(pc), 'Conflicting address/pc fields')
                    value = address if address is not None else pc
                values.append(value)
        require(1 <= len(values) <= PC_LIMIT, f'Provide between 1 and {PC_LIMIT} PCs')
        pcs = list(dict.fromkeys(parse_pc(value) for value in values))
        require(args.maps.stat().st_size <= MAPS_LIMIT, 'Maps file exceeds 2 MiB')
        maps_bytes = args.maps.read_bytes()
        maps = parse_maps(maps_bytes.decode('utf-8'))
        require(not args.output.is_symlink(), 'Output cannot be an existing symlink')
        archive, output = args.tar.resolve(strict=True), args.output.resolve()
        require(not output.exists(), 'Output must be a fresh directory')
        chosen = args.objdump or shutil.which('llvm-objdump') or shutil.which('objdump')
        require(chosen is not None, 'No local objdump found; provide --objdump')
        tool = Path(shutil.which(chosen) or chosen).resolve(strict=True)
        require(tool.is_file() and os.access(tool, os.X_OK), 'objdump is not executable')
    except (ValueError, OSError, UnicodeError) as error:
        parser.error(str(error))
    output.mkdir(parents=True)
    report = {'schema': 1, 'status': 'running', 'tool': 'inspect-bun.py',
              'inspectorSha256': sha_file(__file__), 'requestedPCs': [hex(pc) for pc in pcs],
              'maps': {'sourcePath': str(args.maps.resolve()), 'artifact': 'capture.maps',
                       'bytes': len(maps_bytes), 'sha256': hashlib.sha256(maps_bytes).hexdigest()},
              'limitations': ['Maps identify paths/device/inode at capture time, not content hashes or earlier/later JIT generations.',
                              'The caller must match this archive and maps capture to the profiling campaign.',
                              'Anonymous/JIT or other-file PCs remain unknown; no ELF identity is assigned to them.',
                              'No algorithm identity, routine ABI, speedup or acceleration eligibility is inferred from symbols or opcodes.'],
              'results': []}
    exit_code = 0
    try:
        with (output / 'capture.maps').open('xb') as target:
            target.write(maps_bytes)
        report['provenance'] = extract_member(archive, output / 'bun')
        version = subprocess.run([str(tool), '--version'], check=True, capture_output=True,
                                 text=True, timeout=15, stdin=subprocess.DEVNULL)
        report['objdump'] = {'path': str(tool), 'sha256': sha_file(tool),
                             'version': (version.stdout + version.stderr)[:16384]}
        with (output / 'bun').open('rb') as stream:
            elf = ELF(stream, report['provenance']['memberBytes'])
            report['elf'] = elf.metadata()
            for index, pc in enumerate(pcs):
                result = inspect_pc(pc, maps, elf, args.before, args.after)
                report['results'].append(result)
                if result['status'] != 'mapped-file-bytes':
                    continue
                window = result['disassemblyWindow']
                command = [str(tool), '--disassemble', '--demangle',
                           '--start-address=' + window['startElfVA'],
                           '--stop-address=' + window['stopElfVA'], str(output / 'bun')]
                artifact = f'pc-{index:03d}-{pc:x}.asm.txt'
                completed = subprocess.run(command, capture_output=True, timeout=30, stdin=subprocess.DEVNULL)
                require(len(completed.stdout) + len(completed.stderr) <= 1024 * 1024,
                        'Disassembly output exceeds 1 MiB bound')
                with (output / artifact).open('xb') as target:
                    target.write(completed.stdout)
                    if completed.stderr:
                        target.write(b'\n--- objdump stderr ---\n' + completed.stderr)
                result['disassembly'] = {'command': command, 'returnCode': completed.returncode,
                                          'artifact': artifact, 'sha256': sha_file(output / artifact)}
                require(completed.returncode == 0, f'objdump failed for {hex(pc)}')
        report['status'] = 'passed'
        report['mappedPCs'] = sum(row['status'] == 'mapped-file-bytes' for row in report['results'])
        report['unknownPCs'] = len(pcs) - report['mappedPCs']
    except Exception as error:
        report['status'], report['failure'], exit_code = 'failed', str(error), 1
    finally:
        with (output / 'report.json').open('x') as target:
            json.dump(report, target, indent=2)
            target.write('\n')
    print(json.dumps({'status': report['status'], 'output': str(output),
                      'mappedPCs': report.get('mappedPCs'), 'unknownPCs': report.get('unknownPCs'),
                      **({'failure': report['failure']} if exit_code else {})}))
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
