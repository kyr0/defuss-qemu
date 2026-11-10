import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMaps,classifyAddress,syscallNames} from './maps.mjs';
const raw='00001000-00002000 r-xp 00000100 08:01 42 /usr/local/bin/bun\n'+
 '00002000-00003000 rw-p 00001100 08:01 42 /usr/local/bin/bun\n'+
 '00004000-00005000 r-xp 00000000 00:00 0\n'+
 '00006000-00007000 r-xp 00000000 00:00 0 [vdso]\n';
test('half-open mappings, permissions and file offsets are preserved',()=>{
 const maps=parseMaps(raw);
 assert.equal(classifyAddress('0x1fff',maps,'user').mappedFileOffset,'0x10ff');
 assert.equal(classifyAddress('0x2000',maps,'user').category,'user-nonexecutable-at-map-capture');
 assert.equal(classifyAddress('0x3000',maps,'user').category,'user-unmapped-at-map-capture');
 assert.equal(classifyAddress('0x4000',maps,'user').category,'anonymous-executable-jit-unknown');
 assert.equal(classifyAddress('0x6000',maps,'user').category,'special-executable');
});
test('privilege is authoritative; high addresses retain all bits',()=>{
 const maps=parseMaps(raw);
 assert.equal(classifyAddress('0xfffffffffffff123',maps,'kernel').address,'0xfffffffffffff123');
 assert.equal(classifyAddress('0x1000',maps,'kernel').category,'kernel-unresolved');
 assert.equal(classifyAddress('0x1000',maps).category,'context-unresolved');
 assert.throws(()=>classifyAddress('0x10000000000000000',maps,'user'));
});
test('malformed, overlapping and empty maps fail explicitly',()=>{
 assert.throws(()=>parseMaps(''));
 assert.throws(()=>parseMaps('not a map'));
 assert.throws(()=>parseMaps(raw+'00001000-00003000 r-xp 0 00:00 0\n'));
 assert.equal(parseMaps('1000-2000 r-xp 0 08:01 42 /file with spaces (deleted)\n')[0].path,'/file with spaces (deleted)');
});
test('syscall names derive from retained x86-64 table, not generic ABI numbers',async()=>{
 const table=await readFile(new URL('../../../engine/qemu/linux-user/x86_64/syscall_64.tbl',import.meta.url),'utf8');
 const names=syscallNames(table);assert.equal(names.get(202),'futex');assert.equal(names.get(232),'epoll_wait');assert.equal(names.has(512),false);
});
