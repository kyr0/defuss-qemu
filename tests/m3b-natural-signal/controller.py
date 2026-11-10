import datetime, hashlib, json, os, shutil, signal, subprocess, sys, time, traceback
from pathlib import Path
root=Path.cwd();assert root.name=='defuss-vm'
assert len(sys.argv)==2 and sys.argv[1] in ('0','1')
enabled=sys.argv[1];arm='on' if enabled=='1' else 'off'
for k in ['TMPDIR','TMP','TEMP']:assert Path(os.environ[k]).resolve().is_relative_to(root/'tmp')
out=root/('artifacts/m3b-natural-signal-execution-'+arm+'-01');out.mkdir()
parent_fd=os.open(out.parent,os.O_RDONLY);os.fsync(parent_fd);os.close(parent_fd)
def write(name,value):
 data=value if isinstance(value,bytes) else (json.dumps(value,indent=2)+'\n').encode()
 with (out/name).open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 fd=os.open(out,os.O_RDONLY);os.fsync(fd);os.close(fd)
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
source=Path(__file__).read_bytes();write('controller.py',source)
node=Path(shutil.which('node')).resolve();nodebytes=node.read_bytes()
argv=[str(node),'tests/m3b-natural-signal/run.mjs','--binding','artifacts/m3b-context-v2-binding-01/binding.json','--fixture','artifacts/m3b-natural-signal-fixture-01','--source-manifest','artifacts/m3b-natural-signal-fixture-source-01/manifest.json','--enabled',enabled,'--timeout','1800000','--output','artifacts/m3b-natural-signal-'+arm+'-01']
request={'schema':1,'startedUtc':utc(),'argv':argv,'outerDeadlineSeconds':2100,'scratch':os.environ['TMPDIR'],'controllerSha256':hashlib.sha256(source).hexdigest(),'node':{'path':str(node),'sha256':hashlib.sha256(nodebytes).hexdigest(),'bytes':len(nodebytes)},'scope':'Root-owned single capture. Timeout terminates only its process group; separate browser cleanup audit is required before further execution.'}
write('request.json',request);t=time.monotonic();timedout=False;p=None;error=None;cleanup_error=None
def terminate_owned():
 if p is None or p.poll() is not None:return
 try:os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError:pass
 try:p.wait(timeout=5)
 except subprocess.TimeoutExpired:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  p.wait(timeout=5)
with (out/'stdout.log').open('xb') as stdout,(out/'stderr.log').open('xb') as stderr:
 try:
  p=subprocess.Popen(argv,stdout=stdout,stderr=stderr,start_new_session=True)
  write('process.json',{'pid':p.pid,'processGroup':p.pid,'startedUtc':utc()})
  p.wait(timeout=2100)
 except subprocess.TimeoutExpired:
  timedout=True
 except BaseException:
  error=traceback.format_exc()
 finally:
  try:terminate_owned()
  except BaseException:cleanup_error=traceback.format_exc()
  stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
  result={'schema':1,'completedUtc':utc(),'returncode':p.returncode if p else None,'timedOut':timedout,'error':error,'cleanupError':cleanup_error,'elapsedSeconds':time.monotonic()-t,'outerDeadlineSeconds':2100,'browserCleanupAudit':'required separately','request':request}
  write('execution.json',result)
print(json.dumps({k:result[k] for k in ['returncode','timedOut','error','cleanupError','elapsedSeconds']}));sys.exit((p.returncode if p else 1) or int(timedout or error is not None or cleanup_error is not None))
