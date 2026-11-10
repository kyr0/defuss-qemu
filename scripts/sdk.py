#!/usr/bin/env python3
"""Run a command offline in the pinned SDK with only this project mounted."""
import datetime
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from build import SDK
from container_engine import docker_command

root = Path(__file__).resolve().parents[1]
if len(sys.argv) < 2:
    raise SystemExit('Usage: python3 scripts/sdk.py COMMAND [ARGUMENTS...]')
temporary_root = root / 'tmp'
if temporary_root.is_symlink():
    raise SystemExit('Project tmp must not be a symlink')
temporary_root.mkdir(exist_ok=True)
scratch = Path(tempfile.mkdtemp(prefix='sdk-', dir=temporary_root))
guest_scratch = '/project/' + str(scratch.relative_to(root))
command = docker_command() + ['run', '--rm', '--platform', 'linux/amd64', '--network', 'none',
    '-e', 'TMPDIR=' + guest_scratch, '-e', 'TMP=' + guest_scratch, '-e', 'TEMP=' + guest_scratch,
    '-v', str(root) + ':/project',
    '-v', 'qemu-wasm-arm64-sdk-cache:/emsdk/upstream/emscripten/cache',
    '-w', '/project', SDK, *sys.argv[1:]]
record = {'schema': 1, 'status': 'running',
          'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'sdk': SDK, 'scratch': str(scratch), 'containerScratch': guest_scratch,
          'command': command}
def save_record():
    stage = scratch / 'invocation.json.tmp'
    with stage.open('w') as stream:
        json.dump(record, stream, indent=2); stream.write('\n')
        stream.flush(); os.fsync(stream.fileno())
    stage.replace(scratch / 'invocation.json')
    for directory in (scratch, temporary_root, root):
        descriptor = os.open(directory, os.O_RDONLY)
        try: os.fsync(descriptor)
        finally: os.close(descriptor)
save_record()
try:
    result = subprocess.call(command)
    record.update(status='passed' if result == 0 else 'failed', returncode=result)
except BaseException as error:
    record.update(status='interrupted', error=repr(error))
    raise
finally:
    record['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save_record()
raise SystemExit(result)
