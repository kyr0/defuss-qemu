# MSG1 full-system ISA fixture

These files are a separate source-only addition to the nine frozen MSG1
implementation files in `artifacts/m2-msg1-implementation-01`. No guest build
or execution has been performed yet. The frozen implementation and all MSG2
sources remain unchanged.

`guest-fixture.c` executes seven explicit `0F 38 CC /r` SHA256MSG1 forms:
`xmm1,xmm2`, `xmm1,xmm1`, `xmm0,xmm1`, `xmm1,xmm0`, `xmm0,xmm0`,
`xmm1,[rdi]`, and `xmm0,[rdi]`. Each form runs 4,096 deterministic arbitrary or
edge-word cases. The scalar architectural oracle samples the original source
words, including saved `b[0]`, then applies sigma0 `rotr7 ^ rotr18 ^ shr3`.
All YMM0–2 bytes, untouched upper lanes/registers, source memory and EFLAGS
are compared. Synthetic partial pointer overlaps and the independent BigInt
oracle belong to the separately frozen native/emitted-WASM fixture.

After the seventh form, a separate memory-operand MSG1 PC is warmed 4,096 times,
then its 16-byte operand crosses into `PROT_NONE` in the last eight bytes. This
deliberately leaves `b[0]` readable: the frontend must still perform the entire
architectural m128 load before any helper/inline body. The SIGSEGV handler
requires the exact instruction PC, fault address, `SEGV_ACCERR`, Linux saved
YMM0–2/flags, and restored vectors/flags. It resumes immediately after the
faulting instruction. The preceding observable increment must occur once,
including after the 4,096 successful warmups. The fault must add zero successful
MSG1 executions. Aggregate counters alone do not identify its execution tier.

Eight COM1 G/K gates bound an initial observation and seven intervals. Exact
successful counts are 4,096 for modes 0–5 and 8,192 for mode 6: 32,768 total,
comprising 28,672 ordinary checks plus 4,096 fault-PC warmups. Raw serial replay
requires all seven mode-pass records and exactly one precise fault record.

`build-guest.py` runs inside the pinned Linux amd64 SDK, verifies the original
initramfs hash, preserves source/compiler/log identities, and checks objdump
for exactly eight static MSG1 sites and zero MSG2 sites. It packages the static
fixture into a new initramfs. Build success does not mean guest success.
Compiler scratch is retained only under project `tmp/msg1-guest-*`.

`run-guest.mjs` requires an uninstrumented switch build;
`run-guest-exact.mjs` requires the diagnostic build. Both use the shared
`guest-runner.mjs`, pin the precise guest C source/count contract, rehash the
binary/initramfs/disassembly, and bind runtime bytes to the SDK build and
reviewed implementation/overlay. They reject a combined MSG2 runtime. Selection
must lock to the requested MSG1 mode and a late toggle must return −1. Every
counter read follows confirmed QMP stop; uint64 banks remain decimal strings.
Hot diagnostic on requires `inline > 0`, `fallback = 0` in every interval; hot off
requires `inline = 0`, `fallback > 0`; cold modes require both compiled counts = 0. Original
helpers include fallback, so total is original+inline, not all three banks.

The runner is **Node Emscripten direct execution**, not Chrome. It uses one
vCPU, 512 MiB guest RAM, flags 2 and hotLimit 1500, or 65,535 with `--cold`.
Flags2 disables pressure admission for ISA exposure. This is separate from
production Bun flags 3/hotLimit 1500 exposure and all performance measurements.
Reports explicitly set `timingEligible:false`, preserve failures and use fresh
output paths. Runners never clear an old attempt or kill unrelated processes.

Run only in the root agent's serialized build/validation window:

```sh
python3 -B scripts/with-tmp.py -- python3 -B scripts/sdk.py python3 -B experiments/m2-sha-msg1/build-guest.py --output artifacts/m2-msg1-guest-new
python3 -B scripts/with-tmp.py -- node experiments/m2-sha-msg1/run-guest.mjs --runtime artifacts/m2-msg1-build-new/runtime/x86_64/qemu-system-x86_64.js --fixture artifacts/m2-msg1-guest-new --enabled on --output artifacts/m2-msg1-guest-hot-on-new
python3 -B scripts/with-tmp.py -- node experiments/m2-sha-msg1/run-guest-exact.mjs --runtime artifacts/m2-msg1-diagnostic-build-new/runtime/x86_64/qemu-system-x86_64.js --fixture artifacts/m2-msg1-guest-new --enabled on --output artifacts/m2-msg1-diagnostic-hot-on-new
```

Repeat each relevant runner with `--enabled off`, and both modes with `--cold`,
using fresh output directories. Prepared validator tests are
`node --test experiments/m2-sha-msg1/fixture-check.test.mjs`; they do not boot a
guest. Native/emitted-WASM, SDK, guest and validator execution results remain
pending until separately recorded.
