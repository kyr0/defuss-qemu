"""Retain the original linker's map only beside its exact-hash Wasm evidence."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

root = Path.cwd()
source, output = [Path(value).resolve() for value in sys.argv[1:]]
assert output.parent == root / 'artifacts' and not output.exists()
baseline = json.loads((root / 'manifests/runtime-baseline.json').read_text())
expected = baseline['runtimes']['x86_64']['files']['runtime/x86_64/qemu-system-x86_64.wasm']
build = json.loads((source / 'build-report.json').read_text())
assert build['status'] == 'passed'
assert build['artifacts']['qemu-system-x86_64.wasm'] == expected
assert '--emit-symbol-map' in build['commands'][-1]
identities = {}
for path in [source / 'qemu-system-x86_64.wasm',
             source / 'runtime/qemu-system-x86_64.wasm',
             root / 'runtime/x86_64/qemu-system-x86_64.wasm']:
    data = path.read_bytes()
    identity = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
    assert identity == expected, str(path)
    identities[str(path)] = identity
symbol_file = source / 'qemu-system-x86_64.js.symbols'
lines = symbol_file.read_text().splitlines()
symbols = {}
for line in lines:
    index, name = line.split(':', 1)
    assert index.isdigit() and index not in symbols and name
    symbols[index] = name
missing_indexes = [index for index in range(max(map(int, symbols)) + 1) if str(index) not in symbols]

# Corroborate names against the actual module's exported function indexes.
def leb(position):
    value = shift = 0
    while True:
        byte = data[position]
        position += 1
        value |= (byte & 127) << shift
        shift += 7
        if byte < 128:
            return value, position


position, exported = 8, {}
assert data[:8] == b'\0asm\x01\0\0\0'
while position < len(data):
    kind = data[position]
    size, start = leb(position + 1)
    if kind == 7:
        count, cursor = leb(start)
        for _ in range(count):
            length, cursor = leb(cursor)
            name = data[cursor:cursor + length].decode()
            cursor += length
            export_kind = data[cursor]
            index, cursor = leb(cursor + 1)
            if export_kind == 0:
                exported.setdefault(str(index), []).append(name)
    position = start + size
matches, unmatched = {}, {}
for index, names in exported.items():
    (matches if symbols.get(index) in names else unmatched)[index] = {
        'exports': names, 'linkerName': symbols.get(index)}
assert any('__wasm_call_ctors' in entry['exports'] for entry in matches.values())
assert any('defuss_set_hot_limit' in entry['exports'] for entry in matches.values())
output.mkdir()
copied = {}
for path in [symbol_file, source / 'build-report.json', Path(__file__)]:
    destination = output / path.name
    shutil.copyfile(path, destination)
    copied[path.name] = {'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                        'bytes': destination.stat().st_size}
result = {'schema': 1, 'status': 'passed', 'source': str(source),
          'scope': 'Retained originating linker map, associated with an exact-hash binary by its original build report; exported indexes provide corroboration. Generated Asyncify functions may lack linker names.',
          'runtimeIdentities': identities, 'inputs': copied, 'symbolCount': len(symbols),
          'missingLinkerIndexes': missing_indexes,
          'exportMatches': matches, 'exportAliasesOrMissing': unmatched}
(output / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'symbols': len(symbols),
                  'exportMatches': len(matches), 'aliasesOrMissing': unmatched}))
