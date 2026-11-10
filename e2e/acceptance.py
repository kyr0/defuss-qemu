#!/usr/bin/env python3
"""Run selected release acceptance checks serially, preserving each attempt."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CHECKS = ['isa-off-cold', 'isa-on-cold', 'isa-off-hot', 'isa-on-hot',
          'bun', 'bun-browser', 'freedos', 'busybox', 'slitaz', 'win98']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--check', choices=CHECKS, action='append')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9-]+', args.label):
        parser.error('Use a simple unique label')
    checks = args.check or CHECKS
    package = args.package.resolve()
    if not (package / 'dist/manifest.json').is_file():
        parser.error('Use the installed npm package directory')
    if any(check.startswith('bun') for check in checks) and not args.bundle:
        parser.error('--bundle must name the built .mjs.app directory')
    if 'win98' in checks and not os.environ.get('WIN98_DISK'):
        parser.error('WIN98_DISK must name your installed raw disk')
    output = ROOT / 'artifacts' / args.label
    output.mkdir()
    report = {'status': 'running', 'packageRoot': str(package), 'checks': []}
    try:
        for check in checks:
            label = args.label + '-' + check
            env = {**os.environ, 'DEFUSS_QEMU_PACKAGE': str(package), 'PROFILE': label}
            if check.startswith('isa-'):
                _, mode, tier = check.split('-')
                command = ['node', 'tests/candidate-isa.mjs', str(package), mode, tier, label]
            elif check == 'bun':
                command = ['node', 'tests/bun-bundle.mjs', str(args.bundle.resolve()), label]
            elif check == 'bun-browser':
                command = ['node', 'e2e/bun-bundle.mjs', str(args.bundle.resolve())]
            elif check == 'win98':
                command = ['node', 'e2e/run-win98.mjs']
            else:
                command = ['node', 'e2e/guest-systems.mjs', check]
            result = subprocess.run(command, cwd=ROOT, env=env)
            report['checks'].append({'check': check, 'label': label, 'command': command, 'exitCode': result.returncode})
            (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            result.check_returncode()
        report['status'] = 'passed'
    except Exception as error:
        report.update(status='failed', failure=str(error))
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
