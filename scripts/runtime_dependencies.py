"""Stage literal relative-import dependencies of isolated runtime JS modules.

The generated QEMU glue uses literal dynamic imports; sibling modules use
literal static imports. This is a dependency check for those forms, not a JS
parser. Runtime JS/WASM files themselves are copied by the caller.
"""
import hashlib
from pathlib import Path
import re
import shutil

REFERENCES = re.compile(
    r'''(?:\bimport\s*(?:\(\s*)?|\bfrom\s*|\bnew\s+URL\s*\(\s*)["'](\.\.?/[^"']+)["']''')


def stage_dependencies(runtime, source_web, output_web):
    runtime, source_web, output_web = map(lambda p: Path(p).resolve(),
                                          (runtime, source_web, output_web))
    # A virtual runtime subdirectory preserves ../ sibling resolution even
    # when build output lives outside the source project's web directory.
    virtual_runtime = source_web / '__runtime__'
    pending = []
    for file in runtime.iterdir():
        if file.is_file() and file.suffix in ('.js', '.mjs'):
            for ref in REFERENCES.findall(file.read_text()):
                dependency = (virtual_runtime / ref).resolve()
                if dependency.is_relative_to(virtual_runtime):
                    sibling = runtime / dependency.relative_to(virtual_runtime)
                    if not sibling.is_file():
                        raise FileNotFoundError('Missing runtime sibling: ' + str(sibling))
                else:
                    pending.append(dependency)
    found = {}
    while pending:
        file = pending.pop()
        relative = file.relative_to(source_web)  # Refuse imports outside web root.
        if relative in found:
            continue
        if not file.is_file():
            raise FileNotFoundError('Missing runtime dependency: ' + str(file))
        found[relative] = file
        if file.suffix in ('.js', '.mjs'):
            pending.extend((file.parent / ref).resolve()
                           for ref in REFERENCES.findall(file.read_text()))
    # Discover every required dependency before copying any of them.
    report = {}
    for relative, source in sorted(found.items()):
        target = output_web / relative
        if source != target:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        report[relative.as_posix()] = {
            'bytes': source.stat().st_size,
            'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        }
    return report
