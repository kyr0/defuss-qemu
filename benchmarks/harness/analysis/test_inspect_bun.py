"""Small synthetic fixtures only: python3 -m unittest discover -s benchmarks/harness/analysis -p test_inspect_bun.py"""
import hashlib
import importlib.util
import io
from pathlib import Path
import struct
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('inspect_bun', Path(__file__).with_name('inspect-bun.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(kind=2):
    data = bytearray(0x3000)
    ident = b'\x7fELF\x02\x01\x01' + bytes(9)
    struct.pack_into('<16sHHIQQQIHHHHHH', data, 0, ident, kind, 62, 1, 0x410000,
                     64, 0x2400, 0, 64, 56, 3, 64, 6, 4)
    # Deliberately different file-offset biases for the two PT_LOAD segments.
    struct.pack_into('<IIQQQQQQ', data, 64, 1, 4, 0, 0x200000, 0, 0x1000, 0x1000, 0x1000)
    struct.pack_into('<IIQQQQQQ', data, 120, 1, 5, 0x1000, 0x410000, 0, 0x200, 0x200, 0x1000)
    note = struct.pack('<III', 4, 20, 3) + b'GNU\0' + bytes(range(20))
    struct.pack_into('<IIQQQQQQ', data, 176, 4, 4, 0x2300, 0, 0, len(note), len(note), 4)
    data[0x1000:0x1200] = b'\x90' * 0x200
    names = b'\0exported_wrapper\0later_export\0'
    struct.pack_into('<IBBHQQ', data, 0x2018, 1, 0x12, 0, 1, 0x410010, 8)
    struct.pack_into('<IBBHQQ', data, 0x2030, 18, 0x12, 0, 1, 0x410080, 16)
    data[0x2100:0x2100 + len(names)] = names
    section_names = b'\0.text\0.symtab\0.strtab\0.shstrtab\0.note.gnu.build-id\0'
    data[0x2200:0x2200 + len(section_names)] = section_names
    data[0x2300:0x2300 + len(note)] = note
    def section(index, name, kind, flags, addr, off, size, link=0, entry=0):
        struct.pack_into('<IIQQQQIIQQ', data, 0x2400 + index * 64,
                         section_names.index(name.encode() + b'\0'), kind, flags, addr,
                         off, size, link, 0, 1, entry)
    section(1, '.text', 1, 6, 0x410000, 0x1000, 0x200)
    section(2, '.symtab', 2, 0, 0, 0x2000, 72, 3, 24)
    section(3, '.strtab', 3, 0, 0, 0x2100, len(names))
    section(4, '.shstrtab', 3, 0, 0, 0x2200, len(section_names))
    section(5, '.note.gnu.build-id', 7, 0, 0, 0x2300, len(note))
    return data


def parsed(data=None):
    data = fixture() if data is None else data
    return module.ELF(io.BytesIO(data), len(data))


def maps(path='/usr/local/bin/bun', permissions='r-xp', inode=17, base=0x410000):
    return module.parse_maps(f'{base:x}-{base + 0x1000:x} {permissions} 00001000 00:01 {inode} {path}\n')


class InspectTests(unittest.TestCase):
    def test_elf_identity_and_sparse_symbols(self):
        elf = parsed()
        self.assertEqual(elf.metadata()['gnuBuildId'], bytes(range(20)).hex())
        self.assertEqual(elf.metadata()['type'], 'ET_EXEC')
        self.assertEqual(elf.symbol_tables[0]['entries'], 3)
        self.assertEqual([s['name'] for s in elf.symbols], ['exported_wrapper', 'later_export'])

    def test_exact_segment_mapping_not_global_bias(self):
        result = module.inspect_pc(0x410020, maps(), parsed())
        self.assertEqual(result['status'], 'mapped-file-bytes')
        self.assertEqual(result['mappedFileOffset'], '0x1020')
        self.assertEqual(result['elfVirtualAddress'], '0x410020')
        self.assertEqual(result['segment']['index'], 1)
        self.assertEqual(result['loadBias'], '0x0')
        self.assertEqual(result['algorithmIdentity'], 'unknown')
        symbol = result['nearestSymbols']['preceding']
        self.assertEqual(symbol['name'], 'exported_wrapper')
        self.assertFalse(symbol['withinDeclaredExtent'])
        self.assertEqual(result['mapping']['raw'], '410000-411000 r-xp 00001000 00:01 17 /usr/local/bin/bun')

    def test_et_dyn_uses_captured_relocation(self):
        base = 0x7f00410000
        result = module.inspect_pc(base + 0x20, maps(base=base), parsed(fixture(3)))
        self.assertEqual(result['elfVirtualAddress'], '0x410020')
        self.assertEqual(result['loadBias'], '0x7f00000000')

    def test_unknown_identity_is_not_invented(self):
        for path, permissions, inode, reason in [
            ('', 'r-xp', 0, 'anonymous-executable-jit-unknown'),
            ('[vdso]', 'r-xp', 0, 'special-executable-unknown'),
            ('/bun', 'r-xp', 17, 'file-identity-does-not-match-exact-archive-member'),
            ('/usr/local/bin/bun (deleted)', 'r-xp', 17, 'file-identity-does-not-match-exact-archive-member'),
            ('/usr/local/bin/bun', 'r-xp', 0, 'file-identity-does-not-match-exact-archive-member'),
            ('/usr/local/bin/bun', 'r--p', 17, 'not-executable-at-capture'),
        ]:
            with self.subTest(path=path, permissions=permissions, inode=inode):
                result = module.inspect_pc(0x410020, maps(path, permissions, inode), parsed())
                self.assertEqual(result['status'], 'unknown')
                self.assertEqual(result['reason'], reason)
                self.assertNotIn('elfVirtualAddress', result)
        self.assertEqual(module.inspect_pc(0x999, maps(), parsed())['reason'], 'unmapped-at-capture')

    def test_file_range_end_and_ambiguous_segments(self):
        self.assertEqual(module.inspect_pc(0x410200, maps(), parsed())['reason'], 'outside-executable-file-bytes')
        data = fixture()
        data[176:232] = data[120:176]
        self.assertEqual(module.inspect_pc(0x410020, maps(), parsed(data))['reason'], 'ambiguous-executable-PT_LOAD')

    def test_context_clamps_to_segment_and_decode_starts_at_pc(self):
        result = module.inspect_pc(0x410001, maps(), parsed(), 64, 128)
        self.assertEqual(result['byteWindow']['fileOffset'], '0x1000')
        self.assertEqual(result['byteWindow']['pcOffsetWithinWindow'], 1)
        self.assertEqual(result['disassemblyWindow']['startElfVA'], '0x410001')
        result = module.inspect_pc(0x4101ff, maps(), parsed(), 64, 128)
        self.assertEqual(result['disassemblyWindow']['stopElfVA'], '0x410200')

    def test_invalid_elf_ranges(self):
        mutations = [(32, '<Q', 0x2ff0),  # Program header table exceeds file.
                     (120 + 32, '<Q', 0x3000),  # PT_LOAD filesz exceeds file.
                     (120 + 40, '<Q', 1),  # memsz < filesz.
                     (120 + 48, '<Q', 3),  # Invalid alignment.
                     (0x2018, '<I', 99999)]  # Symbol string offset exceeds table.
        for offset, fmt, value in mutations:
            data = fixture()
            struct.pack_into(fmt, data, offset, value)
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                parsed(data)

    def test_invalid_maps_and_pc_inputs(self):
        for raw in ['', 'garbage',
                    '100-200 r-xp 0 00:01 1 /usr/local/bin/bun\n180-300 r-xp 0 00:01 1 /usr/local/bin/bun',
                    '100-100 r-xp 0 00:01 1 /usr/local/bin/bun',
                    '100-10000000000000001 r-xp 0 00:01 1 /usr/local/bin/bun']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                module.parse_maps(raw)
        for value in ['-1', '1e4', 'abc', '0x10000000000000000', 123]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.parse_pc(value)
        self.assertEqual(module.parse_pc('000123'), 123)
        self.assertEqual(module.parse_pc('0Xff'), 255)

    def test_exact_extraction_hashes_and_no_overwrite(self):
        data = fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive, binary = root / 'test.tar', root / 'bun'
            with tarfile.open(archive, 'w') as tar:
                member = tarfile.TarInfo(module.MEMBER)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
            report = module.extract_member(archive, binary)
            self.assertEqual(binary.read_bytes(), data)
            self.assertEqual(report['memberSha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(report['archiveSha256'], hashlib.sha256(archive.read_bytes()).hexdigest())
            with self.assertRaises(FileExistsError):
                module.extract_member(archive, binary)

    def test_duplicate_or_symlink_members_rejected(self):
        for duplicate in (True, False):
            with self.subTest(duplicate=duplicate), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = root / 'bad.tar'
                with tarfile.open(archive, 'w') as tar:
                    member = tarfile.TarInfo(module.MEMBER)
                    if duplicate:
                        member.size = 64
                        tar.addfile(member, io.BytesIO(bytes(64)))
                        tar.addfile(member, io.BytesIO(bytes(64)))
                    else:
                        member.type, member.linkname = tarfile.SYMTYPE, '/elsewhere'
                        tar.addfile(member)
                with self.assertRaises(ValueError):
                    module.extract_member(archive, root / 'bun')
                self.assertFalse((root / 'bun').exists())


if __name__ == '__main__':
    unittest.main()
