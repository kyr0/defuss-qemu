#!/usr/bin/env python3
"""Bridge the pinned SDK's async poll return type when called from a pthread."""
from pathlib import Path
import sys
path=Path(sys.argv[1])
glue=path.read_text()
# Emscripten upstream issue #27291 / fix #27375. The pinned QEMU image
# predates the fix. Its direct poll returns a number, and a proxied poll
# must return its Promise without unwinding the browser main thread.
before='return Asyncify.handleAsync(innerFunc)};___syscall_poll.isAsync=true;'
after=('return PThread.currentProxiedOperationCallerThread ? Promise.resolve(innerFunc()) : '
       'innerFunc()};___syscall_poll.isAsync=true;')
if glue.count(before) != 1:
    raise SystemExit('Unexpected Emscripten poll glue. Inspect the SDK before using this shim.')
# MEMFS fsync can also complete synchronously when proxied by a pthread.
# This SDK continuation assumes every async-tagged syscall returns a Promise.
gate='if(ctx){rtn.then(rtn=>__emscripten_run_js_on_main_thread_done'
fixed='if(ctx){Promise.resolve(rtn).then(rtn=>__emscripten_run_js_on_main_thread_done'
if glue.count(gate) != 1:
    raise SystemExit('Unexpected Emscripten proxy glue')
path.write_text(glue.replace(before,after).replace(gate,fixed))
