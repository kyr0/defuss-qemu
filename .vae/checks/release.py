"""Verify retained release acceptance against the exact current inputs."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = {'isa-off-cold', 'isa-on-cold', 'isa-off-hot', 'isa-on-hot',
            'bun-node', 'bun-browser', 'freedos', 'busybox', 'slitaz', 'win98-boot', 'win98-app'}


def check(root=ROOT):
    receipt = json.loads((root / 'manifests/release-acceptance.json').read_text())
    if receipt['schema'] != 1 or set(receipt['checks']) != REQUIRED:
        raise ValueError('Release acceptance must cover every required guest and ISA mode')

    def verify(name, expected):
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError('Release evidence must stay in this project: ' + name)
        with path.open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != expected:
            raise ValueError('Release input changed; rerun affected acceptance: ' + name)
        return path

    for name, digest in receipt['inputs'].items():
        verify(name, digest)
    required_inputs = {'manifests/runtime-selected.json', 'manifests/consolidation-candidate.json',
                       'manifests/qemu-import.json',
                       'packaging/npm/index.mjs', 'packaging/bun-app/vm.mjs',
                       'host/browser/win9x.mjs', 'host/browser/candidate.mjs', 'host/browser/runtime-loader.mjs',
                       'tests/candidate-isa.mjs', 'tests/bun-bundle.mjs', 'e2e/guest-systems.mjs', 'e2e/slitaz-ui.mjs', 'e2e/bun-bundle.mjs'}
    selected = json.loads((root / 'manifests/runtime-selected.json').read_text())
    for runtime in selected['runtimes'].values():
        for name, identity in runtime['files'].items():
            path = runtime['directory'] + '/' + name
            if receipt['inputs'].get(path) != identity['sha256']:
                raise ValueError('Missing selected binary binding: ' + path)
    required_inputs.update(str(p.relative_to(root)) for p in (root / 'host/browser').rglob('*')
                           if p.is_file() and p.suffix in {'.mjs', '.wasm'})
    if not required_inputs <= receipt['inputs'].keys():
        raise ValueError('Incomplete release source bindings')
    selected_x86 = {name: identity['sha256'] for name, identity in selected['runtimes']['x86_64']['files'].items()}

    # Bind installed consumers to the current production modules and selected
    # runtimes, independently of documentation changes in the source archive.
    for package, digest in receipt['packages'].items():
        manifest = json.loads(verify(package + '/dist/manifest.json', digest).read_text())
        for name, identity in manifest['files'].items():
            verify(package + '/dist/' + name, identity['sha256'])
            source = None
            if name == 'index.mjs':
                source = 'packaging/npm/index.mjs'
            elif name.startswith(('host/browser/', 'packaging/bun-app/')):
                source = name
            elif name.startswith('firmware/'):
                source = 'engine/qemu/pc-bios/' + name.split('/')[-1]
            elif name.startswith('runtime/') and name.split('/')[1] not in selected['runtimes']:
                source = 'host/browser/' + name.removeprefix('runtime/')
            if source:
                verify(source, identity['sha256'])
        for architecture, runtime in selected['runtimes'].items():
            for name, identity in runtime['files'].items():
                if manifest['files']['runtime/' + architecture + '/' + name] != identity:
                    raise ValueError('Consumer uses a different selected runtime: ' + package)
        for source in required_inputs:
            if source.startswith('host/browser/') and manifest['files'].get(source, {}).get('sha256') != receipt['inputs'][source]:
                raise ValueError('Consumer is missing a current host module: ' + source)

    for name, record in receipt['checks'].items():
        report = json.loads(verify(record['path'], record['sha256']).read_text())
        if report['status'] != 'passed':
            raise ValueError('Unpassed release check: ' + name)
        if name != 'bun-node' and record['package'] not in receipt['packages']:
            raise ValueError('Missing consumer binding: ' + name)
        if report.get('packageRoot') and Path(report['packageRoot']).resolve() != (root / record['package']).resolve():
            raise ValueError('Acceptance used another package: ' + name)
        for path, identity in report.get('harness', {}).items():
            verify(path, identity['sha256'])
        for path, identity in report.get('inputs', {}).items():
            # Guest media inputs may be absolute; the Bun app manifest lives
            # in the bundle rather than the source root.
            if path == 'app.json':
                path = str(Path(report['directory']) / path)
            verify(path, identity['sha256'] if isinstance(identity, dict) else identity)
        if report.get('packageManifest'):
            verify(record['package'] + '/dist/manifest.json', report['packageManifest']['sha256'])
        if name == 'bun-node':
            bundle = Path(report['directory'])
            manifest = json.loads((bundle / 'app.json').read_text())
            if manifest['vm']['msg1'] is not True:
                raise ValueError('Bun bundle must select MSG1')
            for path, identity in manifest['artifacts'].items():
                verify(str(bundle / manifest['generation'] / path), identity['sha256'])
            for path, digest in selected_x86.items():
                if manifest['artifacts']['runtime/' + path]['sha256'] != digest:
                    raise ValueError('Bun bundle uses a different runtime')
        elif name == 'win98-boot':
            if report['identities'] != selected_x86 or report['errors']:
                raise ValueError('Windows 98 boot used different binaries or reported errors')
        elif name in {'bun-browser', 'freedos', 'busybox', 'slitaz'}:
            if report['runtime'] != selected_x86:
                raise ValueError('Guest used different selected binaries: ' + name)
        if name.startswith('isa-'):
            _, mode, tier = name.split('-')
            if report['mode'] != mode or report['tier'] != tier or len(report['gates']) != 8 or report['lateConfigurationResult'] != -1:
                raise ValueError('Incomplete ISA acceptance: ' + name)
        elif name.startswith('bun-'):
            runs = report['runs']
            if [r['mode'] for r in runs] != ['cold', 'restored'] or runs[0]['nonce'] != runs[1]['nonce']:
                raise ValueError('Bun must restore the same state in a separate process')
        elif name in {'freedos', 'busybox', 'slitaz'}:
            if report['guest'] != name or not report['mediaUnchanged'] or not report['checks'] or report['msg1Status'] not in (0x10002, 0x10004):
                raise ValueError('Incomplete guest acceptance: ' + name)
            if name == 'slitaz' and report['file'] != report['token'] + '\ncooking\nx86_64\n':
                raise ValueError('SliTaz requires an actual unique guest disk round trip')
        elif name == 'win98-app':
            if len(report['baseline']) < 3 or len(report['traceCycles']) < 3 or report['errors']:
                raise ValueError('Windows 98 requires three successful application cycles per mode')
            if report['trace']['metadata']['runtimeSettings']['msg1Status'] not in (0x10002, 0x10004):
                raise ValueError('Windows 98 must use selected MSG1 mode')
    print('Release acceptance passed: 4 ISA modes, Bun Node/Chrome restore, FreeDOS, BusyBox, SliTaz, Windows 98')


if __name__ == '__main__':
    try:
        check()
    except (OSError, ValueError, KeyError) as error:
        print('Release acceptance failed: ' + str(error), file=sys.stderr)
        print('Run the affected installed-package acceptance checks with a fresh label, then update manifests/release-acceptance.json from their passed reports.', file=sys.stderr)
        raise SystemExit(1)
