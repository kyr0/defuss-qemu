"""Build a portable VAE bundle and test only its extracted consumer files."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
out = ROOT / 'output/vae-onboarding'
out.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='vae-consumer-', dir=ROOT / 'tmp'))
(work / 'input').mkdir()
archive = work / 'input/defuss-vae-project.zip'
manifest = json.loads((ROOT / '.vae/installation.json').read_text())
paths = ['.agents/' + name for name in manifest['files']]
paths += ['.vae/installation.json', '.vae/checks/installation.py', 'tests/vae/test_installation.py']
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
    for name in paths:
        bundle.write(ROOT / name, name)
consumer = work / 'consumer'
with zipfile.ZipFile(archive) as bundle:
    bundle.extractall(consumer)
(consumer / 'tmp').mkdir()
env = dict(os.environ, TMPDIR=str(consumer / 'tmp'), TMP=str(consumer / 'tmp'),
           TEMP=str(consumer / 'tmp'), PYTHONDONTWRITEBYTECODE='1', VAE_UPDATE_CHECK='0')
result = subprocess.run(['python3', '-B', '-m', 'unittest', 'discover', '-s', 'tests/vae', '-v'],
                        cwd=consumer, env=env, text=True, capture_output=True, timeout=120)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
(out / (stamp + '.log')).write_text(result.stdout + result.stderr)
report = {'status': 'passed' if result.returncode == 0 else 'failed',
          'scope': 'VAE integration artifact, not VM platform acceptance',
          'createdUtc': stamp, 'artifact': str(archive.relative_to(ROOT)),
          'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
          'consumer': str(consumer.relative_to(ROOT)), 'returncode': result.returncode}
(out / (stamp + '.json')).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
raise SystemExit(result.returncode)
