#!/usr/bin/env python3
"""Host-only bounded predecoder fixtures. Run only in an owner-approved timing gap."""
import argparse,datetime,hashlib,json,os,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,value):
    with path.open('x') as stream:
        stream.write(json.dumps(value,indent=2)+'\n');stream.flush();os.fsync(stream.fileno())
    descriptor=os.open(path.parent,os.O_RDONLY);os.fsync(descriptor);os.close(descriptor)
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True)
    parser.add_argument('--cc',default=os.environ.get('CC','clang'),help='One compiler executable (or CC); no shell evaluation')
    parser.add_argument('--sysroot',type=Path,help='Explicit SDK directory; no automatic SDK substitution')
    args=parser.parse_args();output=(ROOT/args.output).resolve()
    if not output.is_relative_to(ROOT/'artifacts') or output.exists():raise ValueError('Fresh artifacts output required')
    output.mkdir(parents=True);os.fsync(descriptor:=os.open(output.parent,os.O_RDONLY));os.close(descriptor)
    scratch=Path(tempfile.mkdtemp(prefix='m3b-predecode-',dir=ROOT/'tmp'))
    found=shutil.which(args.cc)
    if not found:raise ValueError('Requested C11 compiler not found: '+args.cc)
    compiler=str(Path(found).resolve())
    sysroot=args.sysroot.resolve() if args.sysroot else None
    if sysroot is not None and not sysroot.is_dir():raise ValueError('Requested SDK directory not found: '+str(sysroot))
    sdk_flags=['-isysroot',str(sysroot)] if sysroot is not None else []
    sdk_files={str(p):digest(p) for p in ([sysroot/'SDKSettings.json',sysroot/'SDKSettings.plist'] if sysroot else []) if p.is_file()}
    inputs={str(p.relative_to(ROOT)):digest(p) for p in [HERE/'predecode.h',HERE/'test-predecode.c',Path(__file__),HERE/'PREDECODE.md']}
    records=[];report={'schema':1,'kind':'m3b-predecode-host-fixtures','status':'running','createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Native host parser/shape/bounds fixtures only; no guest, QEMU decoder, TCG, generated Wasm, optimizer or timing acceptance.','inputs':inputs,'scratch':str(scratch.relative_to(ROOT)),'compiler':{'requested':args.cc,'path':compiler,'sha256':digest(Path(compiler)),'bytes':Path(compiler).stat().st_size},'sysroot':str(sysroot) if sysroot else None,'sdkMetadata':sdk_files,'commands':records}
    write(output/'started.json',report)
    try:
        for variant,flags in [('plain',[]),('asan-ubsan',['-fsanitize=address,undefined','-fno-omit-frame-pointer'])]:
            binary=scratch/variant
            commands=[[compiler,*sdk_flags,'-std=c11','-O1','-g','-Wall','-Wextra','-Werror',*flags,str(HERE/'test-predecode.c'),'-o',str(binary)],[str(binary)]]
            for index,argv in enumerate(commands):
                completed=subprocess.run(argv,cwd=ROOT,env={**os.environ,'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch)},capture_output=True,text=True,timeout=30)
                record={'variant':variant,'stage':'compile' if index==0 else 'execute','argv':argv,'exitCode':completed.returncode,'stdout':completed.stdout,'stderr':completed.stderr}
                records.append(record);write(output/f'command-{len(records):02}.json',record)
                if completed.returncode:raise ValueError(f'{variant} {record["stage"]} failed')
                if index:record['result']=json.loads(completed.stdout)
        for name,expected in inputs.items():
            if digest(ROOT/name)!=expected:raise ValueError('Input changed: '+name)
        if digest(Path(compiler))!=report['compiler']['sha256']:raise ValueError('Compiler changed during tests')
        for name,expected in sdk_files.items():
            if digest(Path(name))!=expected:raise ValueError('SDK metadata changed: '+name)
        report['status']='passed'
    except Exception as error:
        report['status']='failed';report['failure']=repr(error)
    finally:
        report['finishedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();write(output/'report.json',report)
    print(json.dumps({'status':report['status'],'report':str((output/'report.json').relative_to(ROOT))}))
    return 0 if report['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
