"""Real filesystem, Git, CLI and lifecycle checks for repository onboarding."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('installation', ROOT / '.vae/checks/installation.py')
installation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installation)


class InstallationTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'tmp').mkdir(exist_ok=True)
        self.scratch = tempfile.TemporaryDirectory(prefix='vae-test-', dir=ROOT / 'tmp')
        self.repo = Path(self.scratch.name)
        shutil.copytree(ROOT / '.agents', self.repo / '.agents', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        (self.repo / '.vae').mkdir()
        shutil.copyfile(ROOT / '.vae/installation.json', self.repo / '.vae/installation.json')
        (self.repo / 'tmp').mkdir()
        self.env = dict(os.environ, TMPDIR=str(self.repo / 'tmp'), TMP=str(self.repo / 'tmp'),
                        TEMP=str(self.repo / 'tmp'), PYTHONDONTWRITEBYTECODE='1', VAE_UPDATE_CHECK='0')

    def tearDown(self):
        self.scratch.cleanup()

    def run_command(self, argv, data=None):
        return subprocess.run(argv, cwd=self.repo, env=self.env, input=data, text=True,
                              capture_output=True, timeout=40)

    def cli(self, *args):
        return self.run_command(['python3', '-B', '.agents/scripts/vae.py', *args])

    def hook(self, event):
        result = self.run_command(['python3', '-B', '.agents/hooks/lifecycle.py'], json.dumps(event))
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_complete_payload_and_cli(self):
        self.assertEqual(installation.check(self.repo), [])
        result = self.cli('doctor')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('VERIFIED[plugin.files]=true', result.stdout)

    def test_modified_missing_and_extra_payload_are_rejected(self):
        target = self.repo / '.agents/skills/verify/SKILL.md'
        target.write_text('damaged')
        self.assertTrue(any('Changed payload' in x for x in installation.check(self.repo)))
        target.unlink()
        self.assertTrue(any('Missing or linked' in x for x in installation.check(self.repo)))
        (self.repo / '.agents/unexpected.py').write_text('pass\n')
        self.assertTrue(any('inventory differs' in x for x in installation.check(self.repo)))

    def test_manifest_cannot_escape_or_omit_the_cli(self):
        p = self.repo / '.vae/installation.json'
        manifest = json.loads(p.read_text())
        manifest['files']['../escape'] = {'sha256': '0' * 64, 'bytes': 0}
        del manifest['files']['scripts/vae.py']
        manifest['version'] = 'invalid'
        p.write_text(json.dumps(manifest))
        errors = installation.check(self.repo)
        self.assertTrue(any('Unsafe manifest path' in x for x in errors))
        self.assertTrue(any('Incomplete CLI' in x for x in errors))
        self.assertTrue(any('Plugin version differs' in x for x in errors))

    def test_init_preserves_project_and_session_gate_detects_edits(self):
        self.assertEqual(self.run_command(['git', 'init', '-q']).returncode, 0)
        makefile = self.repo / 'Makefile'
        makefile.write_text('# Existing project entry point\nall:\n\t@echo existing\n')
        original = makefile.read_bytes()
        first = self.cli('init', '--repo', '.')
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual(makefile.read_bytes(), original)
        self.assertEqual(self.cli('init', '--repo', '.').returncode, 0)
        event = {'cwd': str(self.repo), 'session_id': 'integration', 'hook_event_name': 'SessionStart'}
        context = self.hook(event)['hookSpecificOutput']['additionalContext']
        self.assertIn(str(self.repo / '.agents/scripts/vae.py'), context)
        (self.repo / 'new_behavior.py').write_text('raise RuntimeError("not verified")\n')
        denied = self.hook({**event, 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
                            'tool_input': {'command': 'git commit -m test'}})
        self.assertEqual(denied['hookSpecificOutput']['permissionDecision'], 'deny')
        # Resume must preserve the original baseline; it cannot bless this edit.
        self.hook(event)
        denied_again = self.hook({**event, 'hook_event_name': 'PreToolUse', 'tool_name': 'Bash',
                                  'tool_input': {'command': 'git commit -m test'}})
        self.assertEqual(denied_again['hookSpecificOutput']['permissionDecision'], 'deny')


if __name__ == '__main__':
    unittest.main()
