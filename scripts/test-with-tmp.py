#!/usr/bin/env python3
"""Small wrapper contracts; every scratch file remains in project/tmp."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / 'scripts/with-tmp.py'


class WithTmpTests(unittest.TestCase):
    def invoke(self, source, *arguments):
        return subprocess.run([sys.executable, str(WRAPPER), '--',
            sys.executable, '-c', source, *arguments], cwd=ROOT,
            text=True, capture_output=True)

    def scratch(self, stderr):
        line = next(line for line in stderr.splitlines() if line.startswith('with-tmp: '))
        path = Path(line.removeprefix('with-tmp: '))
        self.assertEqual(path.parent, ROOT / 'tmp')
        self.assertRegex(path.name, r'^r-[0-9a-f]{6}$')
        self.assertTrue(path.is_dir())
        return path

    def test_environment_literal_arguments_and_nonzero_exit(self):
        literal = '$(do-not-run) `not-a-shell` with spaces'
        result = self.invoke('''import json,os,sys,tempfile
from pathlib import Path
Path(tempfile.gettempdir(), 'child.txt').write_text('retained')
print(json.dumps({'temporary': [os.environ[k] for k in ('TMPDIR','TMP','TEMP')],
                  'pythonTemp': tempfile.gettempdir(), 'home': os.environ.get('HOME'),
                  'argument': sys.argv[1]}), flush=True)
print('child stderr', file=sys.stderr, flush=True)
sys.exit(23)
''', literal)
        self.assertEqual(result.returncode, 23)
        scratch = self.scratch(result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['temporary'], [str(scratch)] * 3)
        self.assertEqual(data['pythonTemp'], str(scratch))
        self.assertEqual(data['home'], os.environ.get('HOME'))
        self.assertEqual(data['argument'], literal)
        self.assertIn('child stderr', result.stderr)
        self.assertEqual((scratch / 'child.txt').read_text(), 'retained')
        invocation = json.loads((scratch / 'invocation.json').read_text())
        self.assertEqual(invocation['argv'][-1], literal)
        self.assertEqual(invocation['temporaryEnvironment']['TMPDIR'], str(scratch))
        self.assertTrue(invocation['retained'])
        self.assertGreater(json.loads((scratch / 'started.json').read_text())['childPid'], 0)
        final = json.loads((scratch / 'result.json').read_text())
        self.assertEqual(final['exitCode'], 23)
        self.assertIsNone(final['signal'])

    def test_child_signal_remains_a_signal(self):
        result = self.invoke('import os,signal;os.kill(os.getpid(),signal.SIGTERM)')
        self.assertEqual(result.returncode, -signal.SIGTERM)
        final = json.loads((self.scratch(result.stderr) / 'result.json').read_text())
        self.assertEqual(final['signal'], signal.SIGTERM)
        self.assertEqual(final['returncode'], -signal.SIGTERM)
        self.assertIsNone(final['exitCode'])

    def test_streaming_and_signal_forwarding(self):
        process = subprocess.Popen([sys.executable, str(WRAPPER), sys.executable, '-c',
            "import signal;print('ready',flush=True);signal.pause()"], cwd=ROOT,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(process.stdout.readline(), 'ready\n')
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(stdout, '')
            self.assertEqual(process.returncode, -signal.SIGTERM)
            self.assertEqual(json.loads((self.scratch(stderr) / 'result.json').read_text())['signal'], signal.SIGTERM)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_missing_executable_retains_failure_record(self):
        result = subprocess.run([sys.executable, str(WRAPPER), str(ROOT / 'tmp/missing-command')],
                                cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 127)
        final = json.loads((self.scratch(result.stderr) / 'result.json').read_text())
        self.assertEqual(final['status'], 'launch-failed')
        self.assertEqual(final['returncode'], 127)


if __name__ == '__main__':
    unittest.main()
