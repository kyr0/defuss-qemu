"""Verify the installed VAE payload, rather than trusting copied skill names."""
import hashlib
import json
from pathlib import Path


def check(root):
    """Return concrete installation defects; never rewrite the pinned payload."""
    root = Path(root)
    manifest = json.loads((root / '.vae/installation.json').read_text())
    payload = root / '.agents'
    errors = []
    for name, identity in manifest['files'].items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            errors.append('Unsafe manifest path: ' + name)
            continue
        path = payload / relative
        if not path.is_file() or path.is_symlink():
            errors.append('Missing or linked payload: ' + name)
            continue
        data = path.read_bytes()
        if len(data) != identity['bytes'] or hashlib.sha256(data).hexdigest() != identity['sha256']:
            errors.append('Changed payload: ' + name)
    actual = {str(p.relative_to(payload)) for p in payload.rglob('*')
              if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc'}
    if actual != set(manifest['files']):
        errors.append('Payload inventory differs from installation manifest')
    for name in ['scripts/vae.py', 'hooks/lifecycle.py', 'skills/verify/SKILL.md']:
        if name not in manifest['files']:
            errors.append('Incomplete CLI/hook/skill installation: ' + name)
    if json.loads((payload / 'plugin.json').read_text())['version'] != manifest['version']:
        errors.append('Plugin version differs from installation manifest')
    return errors


if __name__ == '__main__':
    defects = check(Path(__file__).resolve().parents[2])
    print(json.dumps({'status': 'failed' if defects else 'passed', 'errors': defects}))
    raise SystemExit(bool(defects))
