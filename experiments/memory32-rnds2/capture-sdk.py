#!/usr/bin/env python3
"""Capture the selected setting from the actual offline pinned SDK."""
from pathlib import Path
import hashlib,json,shutil,subprocess,os
root=Path('/project');source=Path(shutil.which('emcc')).resolve().parent/'src/settings.js'
b=source.read_bytes();lines=b.decode().splitlines();i=next(i for i,l in enumerate(lines)if l.startswith('var MEMORY64 ='))
out=root/'artifacts/memory32-rnds2-sdk-setting-01';out.mkdir()
with (out/'settings-excerpt.txt').open('x')as f:f.write(''.join(f'{j+1}: {lines[j]}\n'for j in range(i-12,i+2)));f.flush();os.fsync(f.fileno())
with (out/'report.json').open('x')as f:json.dump({'status':'passed','source':str(source),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'lines':[i-11,i+2],'emcc':subprocess.check_output(['emcc','--version'],text=True)},f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print('Pinned SDK setting retained')
