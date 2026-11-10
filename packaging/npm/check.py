#!/usr/bin/env python3
"""Build the npm artifact, install it in a clean consumer, and boot it in Chrome."""
from pathlib import Path
import subprocess
from pack import pack

ROOT = Path(__file__).resolve().parents[2]

if __name__ == '__main__':
    report = pack()
    subprocess.run(['node', 'packaging/npm/e2e.mjs', report['tarball'], report['label']], cwd=ROOT, check=True)
