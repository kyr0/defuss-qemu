#!/usr/bin/env python3
"""Retain source-stable host tests and syntax/AST checks; no VM execution."""
import argparse,ast,datetime,hashlib,json,os,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('--output',required=True);a=p.parse_args();out=ROOT/a.output;assert out.resolve().is_relative_to(ROOT/'artifacts');out.mkdir()
def identities():
 return {str(p.relative_to(ROOT)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(HERE.iterdir()) if p.is_file()}
source=identities();report={'schema':1,'status':'failed','sources':source,'commands':[],'timingEligible':False}
try:
 commands=[['node','--test','--test-concurrency=1','tests/m3b-worker-suspension/test.mjs']]+[['node','--check',str(p.relative_to(ROOT))] for p in sorted(HERE.glob('*.mjs'))]
 for argv in commands:
  r=subprocess.run(argv,cwd=ROOT,capture_output=True,timeout=60);row={'argv':argv,'returncode':r.returncode,'stdout':r.stdout.decode(),'stderr':r.stderr.decode()};report['commands'].append(row);assert r.returncode==0,row
 report['pythonAst']=[]
 for p in sorted(HERE.glob('*.py')):ast.parse(p.read_bytes());report['pythonAst'].append(str(p.relative_to(ROOT)))
 assert source==identities();report.update(status='passed',sourceStable=True)
except Exception as e:report['failure']=repr(e)
report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (out/'report.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
print(json.dumps({'status':report['status'],'commands':len(report['commands']),'failure':report.get('failure')}));raise SystemExit(report['status']!='passed')
