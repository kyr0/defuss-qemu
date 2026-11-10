"""Measure the new installation verifier, using stdlib execution tracing."""
import contextlib
import io
from pathlib import Path
import re
import tempfile
import trace
import unittest

ROOT = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='vae-coverage-', dir=ROOT / 'tmp') as directory:
    tracer = trace.Trace(count=True, trace=False, ignoredirs=[str(Path(__file__).parent)])
    # Discovery is traced too: imported executable statements belong in the denominator.
    def run():
        suite = unittest.defaultTestLoader.discover(str(ROOT / 'tests/vae'), pattern='test_*.py')
        return unittest.TextTestRunner(verbosity=1).run(suite)
    result = tracer.runfunc(run)
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        tracer.results().write_results(show_missing=True, summary=True, coverdir=directory)
    rows = [line for line in output.getvalue().splitlines()
            if '(' + str(ROOT / '.vae/checks/installation.py') + ')' in line]
    if not result.wasSuccessful() or len(rows) != 1:
        raise SystemExit('Coverage missing or tests failed: ' + repr(rows))
    percentage = float(re.search(r'\s(\d+(?:\.\d+)?)%', rows[0])[1])
    print(rows[0])
    print('Scope: installation verifier; not QEMU or whole-VM coverage')
    print(f'TOTAL {percentage}%')
    raise SystemExit(0 if percentage >= 60 else 1)
