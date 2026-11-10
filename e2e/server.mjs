#!/usr/bin/env node
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath, stat, readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {root, runtimeDir} from './config.mjs';

const mime = {'.html':'text/html; charset=utf-8', '.mjs':'text/javascript',
  '.js':'text/javascript', '.wasm':'application/wasm', '.json':'application/json'};
export async function startServer({port = 0, runtime = runtimeDir, packageRoot = process.env.DEFUSS_QEMU_PACKAGE, media = {}, crossOrigin = false} = {}) {
  const packaged = packageRoot ? await realpath(packageRoot) : null;
  if (packaged) runtime = resolve(packaged, 'dist/runtime/x86_64');
  const runtimeRoot = await realpath(runtime);
  const mediaFiles = new Map(await Promise.all(Object.entries(media).map(async ([name,path]) => {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw Error('Invalid guest media name');
    return ['/guest-media/' + name, await realpath(path)];
  })));
  const identities = {};
  for (const name of ['qemu-system-x86_64.js','qemu-system-x86_64.wasm']) {
    identities[name] = createHash('sha256').update(await readFile(resolve(runtimeRoot,name))).digest('hex');
  }
  const mounts = [
    ...(packaged ? [['/package/', packaged]] : []),
    ['/e2e/web/', await realpath(resolve(root,'e2e/web'))],
    // Generated pthread glue imports ../graphics.mjs and ../audio/backend.mjs.
    // Preserve that sibling layout without copying or editing runtime binaries.
    ['/host/browser/runtime/', runtimeRoot],
    ['/host/browser/', await realpath(packaged ? resolve(packaged,'dist/host/browser') : resolve(root,'host/browser'))],
    ['/firmware/', await realpath(packaged ? resolve(packaged,'dist/firmware') : resolve(root,'engine/qemu/pc-bios'))]
  ];
  const server = createServer(async (req, res) => {
    for (const [k,v] of Object.entries({'Cross-Origin-Opener-Policy':'same-origin',
      'Cross-Origin-Embedder-Policy':'require-corp', 'Cross-Origin-Resource-Policy':crossOrigin?'cross-origin':'same-origin',
      'Cache-Control':'no-store'})) res.setHeader(k,v);
    if(crossOrigin)res.setHeader('Access-Control-Allow-Origin','*');
    try {
      if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
      const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if (name === '/') {res.writeHead(302,{Location:'/e2e/web/'});res.end();return;}
      if (name === '/runtime-info.json') {res.setHeader('Content-Type',mime['.json']);res.end(JSON.stringify({runtime:runtimeRoot,identities}));return;}
      let file = mediaFiles.get(name);
      if (!file) {
        const mount = mounts.find(([prefix]) => name.startsWith(prefix));
        if (!mount) {res.writeHead(404);res.end();return;}
        const [prefix, base] = mount;
        const suffix = name.slice(prefix.length) || 'index.html';
        if (suffix.split('/').some(part => part === '..' || part === '.') || suffix.includes('\\')) throw Error('Invalid path');
        file = await realpath(resolve(base,suffix));
        if (!file.startsWith(base+sep)) throw Error('Not a mounted file');
      }
      if (!(await stat(file)).isFile()) throw Error('Not a mounted file');
      res.setHeader('Content-Type',mime[extname(file)] || 'application/octet-stream');
      res.setHeader('Content-Length',(await stat(file)).size);
      if (req.method === 'HEAD') {res.end();return;}
      const stream = createReadStream(file);
      stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
    } catch {if (!res.headersSent) res.writeHead(404);res.end();}
  });
  await new Promise((ok,bad)=>{server.once('error',bad);server.listen(port,'127.0.0.1',ok);});
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {origin, demoUrl:origin+'/e2e/web/win9x.html', identities, runtime:runtimeRoot,
    async close(){server.closeAllConnections();await new Promise(ok=>server.close(ok));}};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await startServer({port:Number(process.env.PORT || 18081)});
  console.log(JSON.stringify({url:server.demoUrl,runtime:server.runtime,identities:server.identities}));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await server.close();process.exit(0);});
}
