#!/usr/bin/env python3
"""Run an argv command with retained scratch beneath defuss-vm/tmp."""
import datetime
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_record(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(path.parent)


def make_scratch():
    parent = ROOT / 'tmp'
    if parent.is_symlink():
        raise ValueError('Project tmp must not be a symlink')
    parent.mkdir(mode=0o700, exist_ok=True)
    # Keep paths short enough for browser-created Unix-domain sockets.
    for _ in range(64):
        path = parent / ('r-' + secrets.token_hex(3))
        try:
            path.mkdir(mode=0o700)
        except FileExistsError:
            continue
        sync_directory(parent)
        return path
    raise RuntimeError('Could not allocate unique project scratch')


def main(argv):
    if argv[:1] == ['--']:
        argv = argv[1:]
    if not argv or argv == ['--help']:
        print('Usage: python3 scripts/with-tmp.py [--] COMMAND [ARGUMENTS...]',
              file=sys.stdout if argv else sys.stderr)
        return 0 if argv else 2
    scratch = make_scratch()
    environment = dict(os.environ)
    temporary = {name: str(scratch) for name in ('TMPDIR', 'TMP', 'TEMP')}
    environment.update(temporary)
    write_record(scratch / 'invocation.json', {
        'schema': 1, 'createdUtc': utc(), 'wrapperPid': os.getpid(),
        'parentPid': os.getppid(), 'cwd': os.getcwd(), 'argv': argv,
        'temporaryEnvironment': temporary, 'retained': True,
    })
    print('with-tmp: ' + str(scratch), file=sys.stderr, flush=True)
    child = None
    pending = []
    previous = {}

    def forward(signum, _frame):
        if child is None:
            pending.append(signum)
        elif child.poll() is None:
            try:
                child.send_signal(signum)
            except ProcessLookupError:
                pass

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        previous[signum] = signal.signal(signum, forward)
    began = time.monotonic()
    try:
        try:
            # Inherit all three streams. Never interpolate argv through a shell.
            child = subprocess.Popen(argv, env=environment, shell=False)
        except OSError as error:
            code = 127 if isinstance(error, FileNotFoundError) else 126
            write_record(scratch / 'result.json', {
                'schema': 1, 'completedUtc': utc(), 'status': 'launch-failed',
                'returncode': code, 'error': str(error),
            })
            print('with-tmp: ' + str(error), file=sys.stderr)
            return code
        for signum in pending:
            try:
                child.send_signal(signum)
            except ProcessLookupError:
                pass
        try:
            write_record(scratch / 'started.json', {
                'schema': 1, 'startedUtc': utc(), 'childPid': child.pid,
            })
        except OSError as error:
            # A metadata I/O failure must not orphan an already-started command.
            print('with-tmp: could not record child PID: ' + str(error), file=sys.stderr)
        code = child.wait()
        try:
            write_record(scratch / 'result.json', {
                'schema': 1, 'completedUtc': utc(), 'childPid': child.pid,
                'elapsedSeconds': time.monotonic() - began, 'returncode': code,
                'exitCode': code if code >= 0 else None,
                'signal': -code if code < 0 else None,
            })
        except OSError as error:
            print('with-tmp: could not record result: ' + str(error), file=sys.stderr)
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    if code < 0:
        signum = -code
        if signum not in (signal.SIGKILL, signal.SIGSTOP):
            signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)
    return code


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
