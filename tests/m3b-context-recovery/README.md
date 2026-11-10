# Typed M3b recovery adapter draft

This new host-only adapter will target the separately built context-census
runtime. `typed.mjs` is browser-safe and makes exactly one generation-specific
native call after a durable request. Native refusal is returned for preservation,
then rejected by the host after the stopped raw after-bank is retained.
`mutation.mjs` verifies the exact raw paused changes and preserved native banks.

The warm census witness must still be present: injection occurs before resetting
the watch for the next window. This differs from the unexecuted older PC-only
recovery draft. The proposed cases remain stale-instance after gate 1 and
invalid-descriptor after gate 5 of the unchanged 45-gate image. A new-generation
cold TCI path is expected after invalidation; recompilation is not claimed.

Current status: incomplete source draft; no tests, freeze, review or guest run.
The accepted full baseline is a prerequisite. Runtime/source identity,
context/RF partition, exact one-rejection allowance, original guest digests,
complete trace and independent replay must all be integrated before execution.
