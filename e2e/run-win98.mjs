#!/usr/bin/env node
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile, access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {artifacts, profile, save} from './config.mjs';

await access(artifacts).then(()=>{throw Error('Use a fresh PROFILE; output already exists');},error=>{
  if(error.code!=='ENOENT')throw error;
});

// One owner, one guest at a time. Every completion/failure closes the owned VM.
const children = new Set(), logs = [];
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child,'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(()=>child.kill('SIGKILL'),15000);
  try {await exited;} finally {clearTimeout(timer);}
}
function launch(script, env, ready = false) {
  const child = spawn(process.execPath,[fileURLToPath(new URL(script,import.meta.url))],{
    env:{...process.env,...env}, stdio:['ignore','pipe','pipe']});
  children.add(child);
  child.once('exit',()=>children.delete(child));
  const completed = new Promise((ok,bad)=>{
    child.once('error',bad);
    child.once('exit',(code,signal)=>code === 0 ? ok() : bad(Error(`${script} exited ${code}/${signal}`)));
  });
  completed.catch(()=>{});
  let output='';
  const readiness = ready ? new Promise((ok,bad)=>{
    child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('BASELINE_READY '))ok();});
    completed.then(()=>bad(Error('Boot exited before ready')),bad);
  }) : null;
  for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{
    const text=String(chunk);logs.push(text);process.stdout.write(text);
  });
  return {child, completed, ready:readiness};
}
let interrupted=false;
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{
  interrupted=true;for(const child of children)child.kill('SIGTERM');
});
const report={status:'failed',profile,scope:'Win98 desktop and GUI correctness; timings are diagnostic'};
const watchdog=setTimeout(()=>{interrupted=true;for(const child of children)child.kill('SIGTERM');},Number(process.env.E2E_TIMEOUT_MS||600000));
try {
  const boot=launch('./win98/boot-win98-v68.mjs',{KEEP_OPEN:'1'},true);
  await boot.ready;
  await Promise.race([delay(10000),boot.completed.then(()=>{throw Error('Boot owner exited during settling');})]);
  const benchmark=launch('./win98/benchmark-win98-v68.mjs',{
    ITERATIONS:process.env.ITERATIONS||'3', TRACE_SECONDS:process.env.TRACE_SECONDS||'5'});
  await Promise.race([benchmark.completed,boot.completed.then(()=>{throw Error('Boot owner exited during benchmark');})]);
  if (interrupted)throw Error('Run interrupted or timed out');
  report.status='passed';
} catch(error) {report.failure=String(error.stack||error);process.exitCode=1;}
finally {
  clearTimeout(watchdog);
  for(const child of children)await stop(child);
  await save('run.json',report).catch(()=>{});
  await writeFile(resolve(artifacts,'run.log'),logs.join('')).catch(()=>{});
  console.log(JSON.stringify(report));
}
