"""Run one diagnostic with durable receipts and an owned-browser cleanup check."""
import argparse
import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    os.fsync(fd)
    os.close(fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['calibrate', 'capture', 'pressure'])
    parser.add_argument('output')
    parser.add_argument('execution')
    args = parser.parse_args()
    assert Path.cwd() == ROOT
    capture, execution = [(ROOT / value).resolve() for value in [args.output, args.execution]]
    assert capture.parent == execution.parent == ROOT / 'artifacts'
    assert not capture.exists() and not execution.exists()
    assert not (ROOT / 'artifacts/.m1-campaign.lock').exists(), 'Wait for unprofiled timing'
    execution.mkdir()
    scratch = Path(tempfile.mkdtemp(prefix='engine-cpu-', dir=ROOT / 'tmp'))
    env = dict(os.environ, TMPDIR=str(scratch), TMP=str(scratch), TEMP=str(scratch),
               DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    driver = 'experiments/engine-pressure-exposure/run.mjs' if args.mode == 'pressure' else 'experiments/engine-cpu-profile/run.mjs'
    argv = ['node', 'experiments/engine-cpu-profile/calibrate.mjs', args.output] if args.mode == 'calibrate' else [
        'node', driver, '--arm', 'original', '--output', args.output]
    deadline = 180 if args.mode == 'calibrate' else 2100
    save(execution / 'request.json', {'argv': argv, 'scratch': str(scratch), 'startedUtc': utc(),
                                     'timingEligible': False, 'outerDeadlineSeconds': deadline})
    print(f'{utc()} INFO diagnostic-start mode={args.mode}', flush=True)
    started = time.monotonic()
    proc, timedout = None, False
    with (execution / 'stdout.log').open('xb') as stdout, (execution / 'stderr.log').open('xb') as stderr:
        try:
            proc = subprocess.Popen(argv, stdout=stdout, stderr=stderr, env=env, start_new_session=True)
            save(execution / 'process.json', {'pid': proc.pid, 'processGroup': proc.pid, 'startedUtc': utc()})
            proc.wait(timeout=deadline)
        except subprocess.TimeoutExpired:
            timedout = True
        finally:
            if proc and proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=5)
            stdout.flush(); os.fsync(stdout.fileno())
            stderr.flush(); os.fsync(stderr.fileno())
            save(execution / 'execution.json', {'returncode': proc.returncode if proc else None,
                 'timedout': timedout, 'elapsedSeconds': time.monotonic() - started, 'completedUtc': utc()})
    subprocess.run(['python3', '-B', 'tmp/audit-owned-chrome-01.py', args.execution], check=True, env=env)
    assert proc and proc.returncode == 0 and not timedout, 'Failed attempt retained'
    assert json.loads((capture / 'report.json').read_text())['status'] == 'passed'
    print(f'{utc()} INFO diagnostic-complete mode={args.mode}', flush=True)
