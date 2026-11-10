#!/usr/bin/env python3
"""Predecode and disassemble the exact formation bytes retained by this capture."""
import datetime,hashlib,importlib.util,json,os,re,shutil,subprocess,tempfile,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def identity(p):
    b=p.read_bytes();return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def write(p,value):
    b=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
    with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    fd=os.open(p.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
def main():
    out=ROOT/'artifacts/m3b-bun-code-attribution-bytes-01';out.mkdir()
    scratch=Path(tempfile.mkdtemp(prefix='m3b-current-code-',dir=ROOT/'tmp'))
    paths=['experiments/m3b-code-attribution-validation/inspect-bytes.py','experiments/m3b-admission-diagnosis/predecode-probe.c','experiments/m3b-fallthrough/predecode.h','benchmarks/harness/code/inspect.py','artifacts/m3b-code-attribution-source-01/source/target/i386/tcg/m3b-predecode.h','artifacts/m3b-bun-code-attribution-review-01/review.json','artifacts/m3b-bun-code-attribution-on-01/report.json','artifacts/m3b-bun-code-attribution-on-01/progress.jsonl']
    inputs={p:identity(ROOT/p) for p in paths};commands=[]
    report=dict(schema=1,status='failed',inputs=inputs,commands=commands,observations=[],timingEligible=False,candidatePromotion=False,
        scope='Exact bytes copied at accepted translation and bound to observed descriptor generations. Host C predecode and synthetic-ELF disassembly; no execution of captured bytes. Process mappings are only associations at their named serial gate, not process identity from CR3 or JSC tier/source-function attribution.')
    def run(argv):
        r=subprocess.run(argv,cwd=ROOT,capture_output=True,timeout=60)
        row={'argv':argv,'returncode':r.returncode,'stdout':r.stdout.decode(),'stderr':r.stderr.decode()};commands.append(row);write(out/f'command-{len(commands):02d}.json',row);assert r.returncode==0,row
        return row['stdout']
    try:
        assert inputs[paths[2]]==inputs[paths[4]],'Predecoder matches actual diagnostic source'
        review=json.loads((ROOT/paths[5]).read_bytes());assert review['status']=='passed'
        capture=json.loads((ROOT/paths[6]).read_bytes());assert capture['status']=='passed'
        rows=[json.loads(s) for s in (ROOT/paths[7]).read_text().splitlines()]
        code=review['runs']['on']['lifetime']['code'];assert code==capture['summary']['lifetime']['code']
        records=code['records'];report['attributionAccepted']=review['attributionAccepted']
        spec=importlib.util.spec_from_file_location('elf_builder',ROOT/paths[3]);elf=importlib.util.module_from_spec(spec);spec.loader.exec_module(elf)
        cc=Path('/usr/bin/clang').resolve();sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk');tool=Path(shutil.which('llvm-objdump') or shutil.which('objdump')).resolve()
        report['compiler']={'path':str(cc),**identity(cc),'version':run([str(cc),'--version'])}
        report['objdump']={'path':str(tool),**identity(tool),'version':run([str(tool),'--version'])}
        report['sdkMetadata']={str(p):identity(p) for p in [sdk/'SDKSettings.json',sdk/'SDKSettings.plist'] if p.is_file()}
        binaries=[]
        for variant,flags in [('plain',[]),('asan-ubsan',['-fsanitize=address,undefined','-fno-omit-frame-pointer'])]:
            binary=scratch/variant;run([str(cc),'-isysroot',str(sdk),'-std=c11','-Wall','-Wextra','-Werror','-O1','-g',*flags,str(ROOT/paths[1]),'-o',str(binary)])
            binaries.append((variant,binary))
        for record in records:
            pc=int(record['translationPC'],16);data=bytes.fromhex(record['bytesHex']);assert len(data)==record['bytes']
            label=f"slot-{record['slot']:02d}-gen-{record['generation'][2:]}";binary=out/(label+'.bin');container=out/(label+'.elf');text=out/(label+'.txt')
            write(binary,data);write(container,elf.elf_window(data,pc));decoded=run([str(tool),'--disassemble','--x86-asm-syntax=intel',str(container)]);write(text,decoded.encode())
            assert '<unknown>' not in decoded and '(bad)' not in decoded
            probes=[]
            for variant,probe in binaries:
                result=json.loads(run([str(probe),data.hex(),str(4096-pc%4096)]))
                assert result['result']==0 and result['bytes']==len(data) and result['bOffset']==record['bOffset']
                truncated=json.loads(run([str(probe),data[:-1].hex(),str(4096-pc%4096)]));assert truncated['result']!=0 and truncated['bytes']==0
                probes.append({'variant':variant,'result':result,'truncatedClosingBranchRejected':True})
            mappings=[]
            for row in rows:
                event=row.get('gate',{})
                if event.get('event') not in ('initialized','maps'):continue
                raw=event['maps'].encode();assert len(raw)==event['mapsBytes'] and hashlib.sha256(raw).hexdigest()==event['mapsSha256']
                matches=[]
                for line in event['maps'].splitlines():
                    match=re.match(r'^([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+',line);assert match,'Unexpected maps format'
                    if int(match[1],16)<=pc and pc+len(data)<=int(match[2],16):matches.append(line)
                assert len(matches)<=1
                mappings.append({'event':event['event'],'seq':event['seq'],'pid':event['pid'],'mapsSha256':event['mapsSha256'],'matches':matches})
            first=next(row for row in rows if row['codeRaw'][5]>=record['slot'])
            report['observations'].append({'record':record,'firstObservedSequence':first['sequence'],'firstObservedGate':first.get('gate',{}).get('seq'),'sha256':hashlib.sha256(data).hexdigest(),'binary':{'path':str(binary.relative_to(ROOT)),**identity(binary)},'syntheticElf':{'path':str(container.relative_to(ROOT)),**identity(container)},'disassembly':{'path':str(text.relative_to(ROOT)),**identity(text)},'probes':probes,'namedGateMappingAssociations':mappings})
        for name,id in inputs.items():assert identity(ROOT/name)==id
        for key in ('compiler','objdump'):
            item=report[key];assert identity(Path(item['path']))=={k:item[k] for k in ('sha256','bytes')}
        report['status']='passed'
    except Exception:report['failure']=traceback.format_exc()
    report['completedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write(out/'report.json',report)
    print(json.dumps({'status':report['status'],'observations':len(report['observations']),'failure':report.get('failure')}));return report['status']!='passed'
if __name__=='__main__':raise SystemExit(main())
