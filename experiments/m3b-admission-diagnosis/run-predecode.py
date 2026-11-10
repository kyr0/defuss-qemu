#!/usr/bin/env python3
"""Probe exact retained M1 recurrence bytes against the frozen M3b predecoder."""
import datetime,hashlib,json,os,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/m3b-bun-historical-predecode-01'
CC=Path('/usr/bin/clang').resolve()
SDK=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk')
def digest(p):
    b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def write(p,value):
    with p.open('x') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
def main():
    OUT.mkdir();scratch=Path(tempfile.mkdtemp(prefix='m3b-historical-predecode-',dir=ROOT/'tmp'))
    paths=['experiments/m3b-admission-diagnosis/predecode-probe.c','experiments/m3b-admission-diagnosis/run-predecode.py','experiments/m3b-fallthrough/predecode.h','artifacts/m3b-context-v2-source-01/source/target/i386/tcg/m3b-predecode.h','artifacts/m1-code-disassembly-02/recurrence-evidence.json']
    inputs={p:digest(ROOT/p) for p in paths};report={'schema':1,'status':'failed','inputs':inputs,'compiler':{'path':str(CC),**digest(CC)},'sdk':str(SDK),'sdkMetadata':{str(p):digest(p) for p in [SDK/'SDKSettings.json',SDK/'SDKSettings.plist'] if p.is_file()},'commands':[],'observations':[],'timingEligible':False,'scope':'Host predecoder only on historical stopped M1 bytes. No claim these exact bytes or flags appeared in the new cold M3b captures; no QEMU frontend, IR, mapping, or runtime admission acceptance.'}
    try:
        assert inputs[paths[2]]==inputs[paths[3]],'Current header differs from actual bound runtime'
        evidence=json.loads((ROOT/paths[-1]).read_text());assert evidence['status']=='passed' and len(evidence['observations'])==6
        for variant,flags in [('plain',[]),('asan-ubsan',['-fsanitize=address,undefined','-fno-omit-frame-pointer'])]:
            binary=scratch/variant
            commands=[[str(CC),'-isysroot',str(SDK),'-std=c11','-Wall','-Wextra','-Werror','-O1','-g',*flags,str(ROOT/paths[0]),'-o',str(binary)]]
            for obs in evidence['observations']:
                data=bytes.fromhex(obs['bodyHex']);assert len(data)==40 and hashlib.sha256(data).hexdigest()==obs['bodySha256']
                commands.append([str(binary),obs['bodyHex'],str(4096-(int(obs['bodyPC'],16)&4095))])
            # The full loop requires its closing branch; truncated bytes must not admit.
            commands.append([str(binary),evidence['observations'][0]['bodyHex'][:-2],'4096'])
            for i,argv in enumerate(commands):
                r=subprocess.run(argv,cwd=ROOT,env={**os.environ,'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch)},capture_output=True,text=True,timeout=30)
                row={'variant':variant,'argv':argv,'returncode':r.returncode,'stdout':r.stdout,'stderr':r.stderr};report['commands'].append(row);write(OUT/f'command-{len(report["commands"]):02}.json',row);assert r.returncode==0
                if i:
                    result=json.loads(r.stdout)
                    if i<=6:
                        assert result=={'result':0,'bytes':40,'instructions':9,'bOffset':31,'jccIndex':6,'sideOffset':40,'backedgeOffset':35}
                        report['observations'].append({'variant':variant,'historicalRun':evidence['observations'][i-1]['run'],'sample':evidence['observations'][i-1]['sample'],'bodyPC':evidence['observations'][i-1]['bodyPC'],'result':result})
                    else:assert result['result']!=0 and result['bytes']==0
        for p,id in inputs.items():assert digest(ROOT/p)==id
        assert digest(CC)=={k:report['compiler'][k] for k in ('sha256','bytes')}
        report['status']='passed'
    except Exception:
        import traceback
        report['failure']=traceback.format_exc()
    report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write(OUT/'report.json',report)
    print(json.dumps({'status':report['status'],'observations':len(report['observations']),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
