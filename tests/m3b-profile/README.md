# M3b native control checks

Seven synthetic host tests and JavaScript syntax checks passed in
`artifacts/m3b-safe-gap-host-tests-03` after the final timing repetition ended.
Real VM enforcement remains untested; the diagnostic runtime is not built yet.

`checkProfileControls` belongs before the first `cont` in the later boundary
adapter. It requires exact prelaunch, a locked/eligible native diagnostic profile,
the actual QMP transport, and a durable recorder. The adapter supplies an immutable
readback with exactly `m3bWords` (128 uint32 numbers), `boundaryWords` (256 uint32
numbers), `graph` and `objects` (native exported strings). The copied raw banks
must be returned before semantic validation so a corrupt readback can be retained.
Every operation is recorded before execution, every result before validation, and
the initial and each subsequent complete native readback are recorded before
validation and must remain unchanged.
An unexpected run state is recorded with a null readback and fails before native
memory is accessed. Exact initial bank templates require zero execution counters,
zero failure/reserved words and an unconsumed boundary request number.

The checks distinguish the exact native guard error from ordinary QMP errors,
verify both valid alternative and invalid configurations cannot change after lock,
and require the first boundary
arm to fail at prelaunch. There is one real mutation attempt: a 4 KiB unattached
RAM object. If a broken guard permits it, this isolated stopped VM must fail and
close. No guest continuation, reset, migration, network connection or host-file
write is requested by the helper.

The passed synthetic tests check the verifier's false-positive paths. They do
not establish actual runtime enforcement. The focused test command is:

```sh
python3 -B scripts/with-tmp.py -- node --test tests/m3b-profile/test-controls.mjs
```

Actual profile acceptance additionally needs the reviewed effective graph, native
private-RAM/hidden-backend checks and lifecycle fences. These control-surface checks
do not prove direct internal callback rejection, all launch options, absence of
DMA, intermediate FP/XSTATE preservation or performance.
