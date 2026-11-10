#!/usr/bin/env python3
import argparse,ast,datetime,hashlib,json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();out=ROOT/a.output;assert out.resolve().is_relative_to(ROOT/'artifacts');out.mkdir();scratch=Path(tempfile.mkdtemp(prefix='m3co-host-',dir=ROOT/'tmp'))
def ident(p):b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
paths=[p for p in sorted(HERE.iterdir()) if p.is_file()]+[ROOT/'artifacts/m3b-context-v2-source-01/source/tcg/m3-region-core.h']
sources={str(p.relative_to(ROOT)):ident(p) for p in paths};compiler=Path('/usr/bin/clang');sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk')
report={'schema':1,'status':'failed','sources':sources,'commands':[],'compiler':{'path':str(compiler),**ident(compiler)},'sdk':str(sdk),'scratch':str(scratch.relative_to(ROOT)),'guestExecuted':False,'timingEligible':False,'scope':'Host-model code identity and per-generation counter checks, not actual guest attribution.'}
def command(argv):
 r=subprocess.run(list(map(str,argv)),cwd=ROOT,capture_output=True,timeout=120,env={**os.environ,**{k:str(scratch) for k in ('TMPDIR','TMP','TEMP')}});row={'argv':list(map(str,argv)),'returncode':r.returncode,'stdout':r.stdout.decode(),'stderr':r.stderr.decode()};report['commands'].append(row);assert r.returncode==0,row
try:
 for variant,flags in [('plain',[]),('asan-ubsan',['-fsanitize=address,undefined','-fno-omit-frame-pointer'])]:
  binary=scratch/variant;command([compiler,'-isysroot',sdk,'-std=c11','-O1','-g','-Wall','-Wextra','-Werror',*flags,HERE/'test-observer.c','-o',binary]);command([binary])
 for p in HERE.glob('*.py'):ast.parse(p.read_bytes())
 assert sources=={str(p.relative_to(ROOT)):ident(p) for p in paths};report.update(status='passed',sourceStable=True)
except Exception as e:report['failure']=repr(e)
report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (out/'report.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print(json.dumps({'status':report['status'],'commands':len(report['commands']),'failure':report.get('failure')}));raise SystemExit(report['status']!='passed')
