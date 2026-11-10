#!/usr/bin/env python3
"""Bundle TypeScript and package a snapshot-enabled Linux amd64 Bun distroless VM."""
import argparse,datetime,hashlib,json,os,subprocess,sys,time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from container_engine import docker_command
from bun_app_package import project_scratch, publish_file, write_record

IMAGE='oven/bun@sha256:f6e8216146f6cbe9fecaa7a8161876cafee774ef68013e975c7d63183004b934'
WORKSPACE=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser(description=__doc__,epilog='Requires Docker or DEFUSS_VM_DOCKER_COMMAND and the pinned Bun builder image. Files must be within this project. npm dependencies must already be installed; builds have no network access.')
p.add_argument('entrypoint',type=Path)
p.add_argument('--outfile',type=Path,required=True)
p.add_argument('--project-root',type=Path,default=Path.cwd(),help='Module resolution working directory (default: current directory)')
p.add_argument('--manifest',type=Path,help='Build record (default: OUTFILE.build.json)')
p.add_argument('--minify',action='store_true')
p.add_argument('--bundle-only',action='store_true',help='Emit only portable JavaScript (e.g. architecture benchmarks)')
p.add_argument('--app-dir',type=Path,help='Runnable app package (default: OUTFILE.app)')
p.add_argument('--os',choices=['linux'],default='linux',help='Guest OS (only Linux is supported)')
p.add_argument('--arch',choices=['amd64'],default='amd64',help='Guest architecture (amd64 is the current app target)')
p.add_argument('--snapshot-ready',choices=['after-module','manual'],default='after-module',help='Default: signal after top-level module initialization; manual apps signal COM1 themselves')
p.add_argument('--runtime-dir',type=Path,help='Use a local amd64 QEMU JS/WASM runtime; its hashes remain part of snapshot compatibility')
a=p.parse_args()
entry=a.entrypoint.resolve();output=a.outfile.resolve();project=a.project_root.resolve()
manifest=a.manifest.resolve() if a.manifest else Path(str(output)+'.build.json')
app_dir=a.app_dir.resolve() if a.app_dir else Path(str(output)+'.app')
if a.bundle_only and a.app_dir:p.error('--app-dir requires app packaging (omit --bundle-only)')
if a.bundle_only and a.runtime_dir:p.error('--runtime-dir requires app packaging (omit --bundle-only)')
runtime_dir=a.runtime_dir.resolve() if a.runtime_dir else None
if runtime_dir and (not runtime_dir.is_relative_to(WORKSPACE) or not runtime_dir.is_dir()):p.error('--runtime-dir must be a directory inside the workspace')
for name,path in [('entrypoint',entry),('outfile',output),('project root',project),('manifest',manifest),('app directory',app_dir)]:
 if not path.is_relative_to(WORKSPACE):p.error(name+' must be inside '+str(WORKSPACE))
if not entry.is_file():p.error('Missing entrypoint: '+str(entry))
if not project.is_dir():p.error('Missing project root: '+str(project))
if not entry.is_relative_to(project):p.error('Entrypoint must be inside project root')
if output==entry or manifest in [entry,output]:p.error('Entrypoint, outfile and manifest must be distinct')
if app_dir in [entry,output,manifest] or any(path.is_relative_to(app_dir) for path in [entry,output,manifest]):p.error('App directory must not contain the entrypoint, outfile or build manifest')
output.parent.mkdir(parents=True,exist_ok=True);manifest.parent.mkdir(parents=True,exist_ok=True)
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
start=time.monotonic();env=dict(os.environ)
with project_scratch('bundle-', [output.parent,manifest.parent]) as scratch:
 staging=scratch/'bundle';staging.mkdir()
 container_scratch=scratch/'container';container_scratch.mkdir()
 host_scratch=scratch/'host';host_scratch.mkdir()
 env.update({name:str(host_scratch) for name in ('TMPDIR','TMP','TEMP')})
 bun_args=['build','./'+str(entry.relative_to(project)),'--target','bun','--outfile','/out/'+output.name]
 if a.minify:bun_args.append('--minify')
 command=docker_command()+['run','--rm','--platform','linux/arm64','--network','none',
  '-v',str(WORKSPACE)+':/work:ro','-v',str(staging)+':/out','-v',str(container_scratch)+':/scratch',
  '-e','TMPDIR=/scratch','-e','TMP=/scratch','-e','TEMP=/scratch',
  '-w','/work/'+str(project.relative_to(WORKSPACE)),IMAGE,*bun_args]
 write_record(scratch/'command.json',{'schema':1,'argv':command,'hostTemporaryDirectory':str(host_scratch),'containerTemporaryDirectory':'/scratch'})
 result=subprocess.run(command,env=env,text=True,capture_output=True)
 for name,text in [('stdout.log',result.stdout),('stderr.log',result.stderr)]:
  with (scratch/name).open('x') as log:
   log.write(text);log.flush();os.fsync(log.fileno())
 write_record(scratch/'child-result.json',{'schema':1,'returncode':result.returncode})
 if result.stdout:print(result.stdout,end='')
 if result.stderr:print(result.stderr,end='',file=sys.stderr)
 if result.returncode:raise SystemExit(result.returncode)
 built=staging/output.name
 if not built.is_file():raise SystemExit('Bun reported success but did not create the bundle; prior output preserved')
 report={'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'builderImage':IMAGE,'builderVersion':'1.4.4','target':'bun','format':'esm','minify':a.minify,'entrypoint':str(entry.relative_to(WORKSPACE)),'entrypointSha256':sha(entry),'projectRoot':str(project.relative_to(WORKSPACE)),'outfile':str(output.relative_to(WORKSPACE)),'bytes':built.stat().st_size,'sha256':sha(built),'bunArguments':bun_args,'seconds':time.monotonic()-start,'stdout':result.stdout,'stderr':result.stderr,'scope':'One portable JS bundle for the amd64 and arm64 Bun runtimes; Node/Bun builtins remain runtime imports'}
 if not a.bundle_only:
  from bun_app_package import package_app
  app_manifest=package_app(built,app_dir,manual_ready=a.snapshot_ready=='manual',runtime_dir=runtime_dir)
  report['app']={'manifest':str(app_manifest.relative_to(WORKSPACE)),'os':'linux','architecture':'amd64','snapshot':True,'readyMode':a.snapshot_ready}
  if runtime_dir:report['app']['runtimeDirectory']=str(runtime_dir.relative_to(WORKSPACE))
  report['scope']='Portable JS plus a Linux amd64 Bun distroless app package, with COM1 snapshots enabled by default'
 record_path=scratch/'build-manifest.json'
 write_record(record_path,report)
 built.chmod(0o644);publish_file(built,output)
 # The fully written record and bundle each publish by same-filesystem rename.
 record_path.chmod(0o644);publish_file(record_path,manifest)
print(f'Bundle: {output}\nSHA-256: {report["sha256"]}\nManifest: {manifest}')
if not a.bundle_only:print(f'App: {app_manifest}\nRun: node packaging/bun-app/run.mjs "{app_dir}"')
