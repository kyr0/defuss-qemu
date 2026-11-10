#!/usr/bin/env node
// Explicit candidate list replaces historical hard-coded servers on three ports.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root} from '../config.mjs';

assert.ok(process.argv[2], 'Usage: node e2e/win98/run-win98-ab.mjs profiles.json fresh-label');
const profiles=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
const label=process.argv[3];assert.match(label||'',/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
assert.ok(Array.isArray(profiles)&&profiles.length>=2,'Provide at least two explicit profiles');
const names=new Set();
for (const item of profiles) {
  assert.match(item.name||'',/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
  assert.ok(!names.has(item.name),'Duplicate profile name');names.add(item.name);
  assert.equal(typeof item.runtime,'string','Each profile needs an explicit runtime directory');
  assert.ok(!item.env || Object.keys(item.env).every(k=>['CPU','VIDEO','DISPLAY','DISPLAY_HZ','SOUND','RAM','TB_CACHE','HOT_LIMIT','COMPAT','ACK_REPAINT'].includes(k)),'Unsupported profile option');
}
const output=resolve(root,'artifacts/e2e',label);
await mkdir(dirname(output),{recursive:true});await mkdir(output);
const summary={status:'running',scope:'Serial comparison diagnostics, not a statistical performance claim',profiles:[]};
let active,stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;active?.kill('SIGTERM');});
try {
  for(const item of profiles) {
    if(stopping)throw Error('Interrupted');
    active=spawn(process.execPath,[fileURLToPath(new URL('../run-win98.mjs',import.meta.url))],{
      env:{...process.env,...item.env,PROFILE:label+'-'+item.name,RUNTIME_DIR:item.runtime,BASELINE_ONLY:'1'},stdio:'inherit'});
    const [code,signal]=await once(active,'exit');active=null;
    summary.profiles.push({name:item.name,runtime:item.runtime,code,signal});
    if(code!==0||stopping)throw Error('Profile failed: '+item.name);
  }
  summary.status='passed';
}catch(error){summary.status='failed';summary.failure=String(error);process.exitCode=1;}
await writeFile(resolve(output,'comparison.json'),JSON.stringify(summary,null,2)+'\n');
