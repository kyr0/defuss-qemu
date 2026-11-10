/// <reference path="../globals.d.ts" />
import {openSync, readSync, writeSync, closeSync, writeFileSync, readFileSync} from 'node:fs';

// Deliberately stateful: a restored process must retain this nonce, heap and file.
const nonce = crypto.randomUUID();
const prepared = Array.from({length: 4096}, (_, i) => ({id: i, value: i * 7}));
const sum = prepared.reduce((total, row) => total + row.value, 0);
writeFileSync('/tmp/initialized.json', JSON.stringify({nonce, sum}));
console.log('APP_INITIALIZED ' + JSON.stringify({nonce, sum, arch: process.arch, bun: Bun.version}));
const server = Bun.serve({hostname: '127.0.0.1', port: 3000, fetch() {
  return Response.json({nonce, sum, rows: prepared.length});
}});

const mode = bunWasm.snapshotReady();
console.log('APP_RESUMED ' + JSON.stringify({nonce, sum, mode}));
const serial = openSync('/dev/ttyS0', 'r+');
// Repeated readiness signals must not replace the first snapshot or send extra ACKs.
writeSync(serial, Buffer.from('111'));
const command = Buffer.alloc(1);
if (readSync(serial, command, 0, 1, null) !== 1 || command.toString() !== 'P') throw Error('Expected COM1 ping');
const response = await fetch('http://127.0.0.1:3000/').then(r => r.json());
const file = JSON.parse(readFileSync('/tmp/initialized.json', 'utf8'));
if (response.nonce !== nonce || file.nonce !== nonce || response.sum !== sum || file.sum !== sum || response.rows !== prepared.length) throw Error('Restored state mismatch');
writeSync(serial, Buffer.from('PONG:' + nonce + '\n'));
closeSync(serial);
server.stop(true);
console.log('APP_VERIFIED ' + JSON.stringify({nonce, sum, mode, http: true, heap: true, file: true, serial: true}));
