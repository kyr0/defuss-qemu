import {writeFileSync, readFileSync} from 'node:fs';

// Console output must never be confused with COM1 readiness.
console.log('1');
const nonce = crypto.randomUUID();
await Bun.sleep(100);
const initialized = {nonce, value: 42};
writeFileSync('/tmp/automatic.json', JSON.stringify(initialized));
console.log('AUTO_INITIALIZED ' + JSON.stringify(initialized));
const server = Bun.serve({hostname: '127.0.0.1', port: 3000, fetch() { return Response.json(initialized); }});

// No explicit snapshot helper. The packaging wrapper gates after this module.
setTimeout(async () => {
  const file = JSON.parse(readFileSync('/tmp/automatic.json', 'utf8'));
  const response = await fetch('http://127.0.0.1:3000/').then(r => r.json());
  if (file.nonce !== nonce || response.nonce !== nonce || response.value !== 42) throw Error('Automatic snapshot state mismatch');
  console.log('AUTO_VERIFIED ' + JSON.stringify({nonce, file: true, http: true}));
}, 200);
