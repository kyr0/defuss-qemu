"""Exact retained QEMU links; generic project evidence remains no-symlink.

File aliases contribute their logical filename and resolved file-byte hash,
matching prepare.py/build.py. Directory links are not traversed by rglob and
do not add alias descendants; their canonical target closure is still hashed.
"""
import hashlib
import os
from pathlib import Path
import stat


LINKS = {
    'rust/hw/char/pl011/build.rs': ('../../../bindings/build.rs', 'rust/bindings/build.rs', 'file'),
    **{'rust/bindings/' + name + '/build.rs': ('../build.rs', 'rust/bindings/build.rs', 'file')
       for name in ('qom-sys', 'system-sys', 'hwcore-sys', 'util-sys', 'chardev-sys', 'migration-sys')},
    'subprojects/libvduse/standard-headers/linux': ('../../../include/standard-headers/linux', 'include/standard-headers/linux', 'directory'),
    'subprojects/libvduse/linux-headers/linux': ('../../../linux-headers/linux', 'linux-headers/linux', 'directory'),
    'subprojects/libvhost-user/standard-headers/linux': ('../../../include/standard-headers/linux', 'include/standard-headers/linux', 'directory'),
    **{'subprojects/' + project + '/include/' + name + '.h':
       ('../../../include/qemu/' + name + '.h', 'include/qemu/' + name + '.h', 'file')
       for project in ('libvduse', 'libvhost-user') for name in ('compiler', 'atomic')},
}


def require(value, message):
    if not value:
        raise ValueError(message)


def stamp(path):
    s = path.lstat()
    return (s.st_dev, s.st_ino, s.st_mode, s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def fingerprint(files):
    digest = hashlib.sha256()
    # pathlib sorts by path components, not raw POSIX text: headers/one.h
    # precedes headers.h, matching the actual sorted(Path.rglob(...)) caller.
    for name, row in sorted(files.items(), key=lambda item: Path(item[0])):
        digest.update(name.encode() + b'\0')
        digest.update(bytes.fromhex(row['sha256']))
    return digest.hexdigest()


def scan(tree, contract):
    """Metadata only. Reject every link outside the exact root-relative map."""
    require(tree.is_dir() and tree.resolve() == tree, 'Canonical real engine root required')
    entries = sorted(tree.rglob('*'))
    observed, logical = {}, []
    for path in entries:
        name = path.relative_to(tree).as_posix()
        if path.is_symlink():
            require(name in contract, 'Unreviewed engine link: ' + name)
            text, target_name, kind = contract[name]
            before = stamp(path)
            require(os.readlink(path) == text and not Path(text).is_absolute(), 'Link text changed: ' + name)
            target = tree / target_name
            require(not Path(target_name).is_absolute() and '..' not in Path(target_name).parts and
                    target.resolve(strict=True) == target, 'Noncanonical target closure: ' + name)
            require(Path(os.path.abspath(path.parent / text)) == target and path.resolve(strict=True) == target,
                    'Link escapes or resolves through another link: ' + name)
            require(kind in ('file', 'directory') and (target.is_file() if kind == 'file' else target.is_dir()),
                    'Link target kind changed: ' + name)
            require(stamp(path) == before and os.readlink(path) == text, 'Link changed during scan: ' + name)
            observed[name] = {'text': text, 'target': target_name, 'kind': kind, 'lstat': list(before),
                              'linkTextSha256': hashlib.sha256(os.fsencode(text)).hexdigest()}
            if kind == 'file' and '__pycache__' not in path.parts and path.suffix != '.pyc':
                logical.append(name)
        else:
            # A directory symlink ancestor would violate this equality even if
            # a future pathlib traversal began following directory links.
            require(path.resolve() == path, 'Symlink ancestor in engine entry: ' + name)
            mode = path.lstat().st_mode
            require(stat.S_ISDIR(mode) or stat.S_ISREG(mode), 'Special engine entry: ' + name)
            if stat.S_ISREG(mode) and '__pycache__' not in path.parts and path.suffix != '.pyc':
                logical.append(name)
    require(set(observed) == set(contract), 'Expected engine link missing/replaced')
    return sorted(logical), observed


class EngineTree:
    def __init__(self, tree, audit, contract=None):
        self.tree, self.audit = Path(tree), audit
        self.contract = LINKS if contract is None else contract
        self.names, self.links = scan(self.tree, self.contract)
        self.files = {}
        for name in self.names:
            # Do not pass an alias to generic Audit.file: it stays strict.
            target = self.links[name]['target'] if name in self.links else name
            self.files[name] = audit.file(self.tree / target)
        self.evidence = []
        for name, row in sorted(self.links.items()):
            target = row['target']
            if row['kind'] == 'file':
                require(target in self.files and target not in self.links, 'Target absent from regular closure')
                closure = {target: self.files[target]}
            else:
                closure = {p: value for p, value in self.files.items() if p.startswith(target + '/')}
                require(closure and all(p not in self.links for p in closure), 'Directory target closure incomplete')
            self.evidence.append({'path': name, **row, 'targetFiles': closure,
                                  'targetClosureFingerprint': fingerprint(closure)})
        self.stable()

    def stable(self):
        names, links = scan(self.tree, self.contract)
        require(names == self.names and links == self.links, 'Engine names/link metadata changed during audit')


def compare_links(base, source):
    require(base.contract == source.contract, 'Engine link contracts differ')
    require({n: {k: r[k] for k in ('text', 'target', 'kind')} for n, r in base.links.items()} ==
            {n: {k: r[k] for k in ('text', 'target', 'kind')} for n, r in source.links.items()},
            'Prepared links differ from retained baseline')
