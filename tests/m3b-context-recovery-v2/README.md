# M3b typed recovery with census ABI2

This new 15-file host adapter ports the retained, unexecuted
`tests/m3b-context-recovery` draft to the separately built
`m3b-context-census-v2` runtime. The old recovery draft, census-v1 failure,
frozen runtime sources and original 45-gate guest image remain unchanged.
The pre-v4 recovery sources passed 20 host tests in
`artifacts/m3b-context-recovery-v2-host-tests-02/report.json`. Their exact 15
source bytes are retained under
`artifacts/m3b-context-recovery-v2-before-v4-port-01`; those checks did not
execute a VM. The unexecuted 23-test v4 port is separately preserved under
`artifacts/m3b-context-recovery-v2-before-v5-port-01`. The v5 port passed
25 host tests and 13 syntax checks in `artifacts/m3b-context-recovery-v2-host-tests-03`;
its exact 15 sources are preserved under `artifacts/m3b-context-recovery-v2-before-cache-fix-01`.
The subsequent cache cleanup and stricter old-frame stop check have 27
host-test declarations, unexecuted at authoring. An accepted,
independently reviewed ABI2 baseline is a prerequisite; this source does not
grant recovery or baseline acceptance.

Both arms use the same fixed diagnostic profile and original guest calls:
512MiB RAM, `-global apic.vapic=off`, M3a enabled, hot1500/flags2, cap12000,
and census enabled. Only the ON arm issues the two supported stopped native
requests, before the warm watch is reset:

- After gate1, mark the exact retained add32 owner generation's compiled
  instance stale. Gate2 requires one stale-instance miss, the same owner and
  compiled fused reentry. Global installation growth is required, but is not
  attributed as exactly one installation.
- After gate5, clear the exact retained add64 descriptor's valid bit. Gate6
  requires one old-owner early rejection with its exact stopped-chain
  certificate, one freshly formed/emitted owner and a newer generation.
  The new owner may execute in TCI, compiled code or a recorded mixture.
  Gates7/8 must retain that new generation. New-generation recompilation is
  reported only if the native compiled tier actually occurs.

The native typed API still selects exactly one valid normal fused owner by
PC, generation and retained context in two passes. This adapter calls it once;
no runtime guard is bypassed. A durable request precedes invocation. The
native return code and confirmed-paused raw after-bank are retained even on
refusal, then the host rejects the capture without another ACK/cont.

ABI2 uses access mask `0x00f0ff00` for the canonical segment-flags fields and
retains the original raw ES/CS/SS/DS/FS/GS/LDT/TR words at tuple90..97.
Same-owner comparisons use the reviewed `sameCensusTuple` helper: only those
raw copies may differ between execution windows. All owner/generation/code,
physical pages, full flags/cflags, selector, full base, decoded limit,
architectural access bits and reserved98..111 remain exact. Recorded CPU
contexts use `semanticTraceContext` while retaining every original printed
row. Paused injection evidence has no such exemption: every raw word must
remain identical except the exact request/action counters and metadata.

The recovery oracle retains the original 45 gate records, per-call integer,
flags and defined legacy FXSAVE checks, and all digest/check totals. Complete
census attempts and RF trace certificates must reconcile every positive
measured window. Only the one source-defined old-owner guard refusal at gate6
is projected out of selected-entry classification; its raw frame/stop remain
retained, and its lifetime/watched rejection count must be exactly one.
If the rejected owner has a logged frame, that frame must have exactly that
one attached stop, so projecting it cannot hide another stop. The
M3a invalid-redispatch counter stays zero, and its existing invalidation count
must not increase during gates1..8: the fused guard rejects before M3a
redispatch, and the injector already cleared descriptor validity. Flushes,
retirement and other invalidations are forbidden throughout gates1..8. RF owners stay unchanged if observed in both windows. No native
entry is relabeled as a retired body or as compiled execution.

The global `tciTargetReturns` counter records ordinary TCI routing back to
an outer fused-target guard before admission. As in reviewed accounting-v3,
its exact monotonic delta is retained separately as `globalGuardRedispatches`
for both same-owner and fresh-owner windows. It supplies no watched-owner,
selected-tier, service or logical-body term. Non-fresh fused TCI remains
forbidden, its watched backedge count must stay zero, and a fresh owner's
cold backedge returns cannot exceed its B attempts. Counter decreases,
invalid counts and every typed mutation, service and body guard still reject.

The imported v5 host transport keeps512MiB total trace,64MiB pending queue,
128MiB stopped windows and64KiB chunk bounds. Complete chunk hashes and bytes are fsynced before host
acknowledgement; each bounded stopped window is retained before semantic
validation. A final stopped state, exact raw serial/progress replay, served
source/image/runtime identities and independent capture review remain
required. The inherited v4 terminal parser accepts the entire final trace suffix as at most
64KiB of exact ASCII linking records or an empty suffix. Its separate
`terminal-summary.json` is fsynced before the complete oracle, bound in the
report and independently reproduced by the same-code inspector. The final
raw trace byte count must equal that summary's end; no suffix is skipped.
The cumulative watched census total must stay unchanged after the final
disabled reset. This does not establish absence of unwatched kernel work.
Typed mutations, recovery body partitions and all45 guest oracles remain
unchanged. This is controlled metadata recovery, not natural SMC, eviction,
natural interrupt, performance or full-XSTATE evidence.

The separate recovery freeze requires the accepted ABI2 baseline review and
runtime binding. It verifies the pinned native/proof source manifest
`artifacts/m3b-context-v2-native-source-01/manifest.json` with SHA256
`c804956c31d854103c8dae13ca088a93ab31a692fe011d5745d9f787b27826cb`
before loading `experiments/m3b-context-proof-v2/proof.py`. It does not modify
or replace the combined baseline source freeze. The v5 host/accounting manifest and review
are mandatory dependencies at `artifacts/m3b-context-v5-source-01/manifest.json`
and `artifacts/m3b-context-v5-source-review-01/review.json`; their complete
live/archive/dependency closure is retained. The runtime binding remains ABI2.
The recovery verifier invokes the unchanged v5 source verifier and uses its
bound native logging source for terminal summaries. The original layout file
`artifacts/m3b-fixture-01/layout.json` is a test input and must be included in
the retained host-test provenance. Four small archived sources (`typed.mjs`,
`mutation.mjs`, `recovery-contract.mjs`, `oracle.mjs`) from before the v5 port
are additional source-equivalence test inputs. The freezer preserves both
15-file archives, the passed host-test reports, the tested pre-cache-cleanup
archive, all 24 reviewed v5
runner/accounting files with their archives and dependencies, and every
identity in the accepted baseline review inventory map.

The source verifiers use the frozen inspection-v6 input-bound helper. Only
an exact hash-bound `artifacts/<directory>/native-trace.log` identity may
exceed the default 128MiB input bound, up to the existing 512MiB trace limit.
An explicitly lower bound is never widened. Every read returns and hashes
the full actual bytes; metadata and provenance buffers are not kept in the
capture server's cache. After inherited binding verification, exactly seven
verified runtime buffers are retained and the inherited buffer map is cleared.
Only these runtime files and explicit browser and fixture assets are cached.
Post-capture identity rechecks stream all inputs. These dependency-read bounds
do not alter the 128MiB stopped windows or the complete 45-gate oracle.

Prospective commands below require the builder to be stopped and no other VM
run. Artifact paths for tests, baseline acceptance and source review must
exist from the actual reviewed evidence before dependent commands execute;
they are not fabricated by these examples.

```sh
python3 -B scripts/with-tmp.py -- node --test --test-concurrency=1 \
  tests/m3b-context-recovery-v2/test-typed.mjs \
  tests/m3b-context-recovery-v2/test-recovery-contract.mjs \
  tests/m3b-context-recovery-v2/test-oracle.mjs

python3 -B scripts/with-tmp.py -- python3 -B tests/m3b-context-recovery-v2/freeze.py \
  --output artifacts/m3b-context-recovery-v2-source-01 \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --baseline-review artifacts/m3b-context-v2-baseline-review-01/review.json \
  --test-evidence artifacts/m3b-context-recovery-v2-host-tests-04/report.json \
  --dependency artifacts/m3b-fixture-01/layout.json

python3 -B scripts/with-tmp.py -- node tests/m3b-context-recovery-v2/run.mjs \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --fixture artifacts/m3b-fixture-01 \
  --source-manifest artifacts/m3b-context-recovery-v2-source-01/manifest.json \
  --source-review artifacts/m3b-context-recovery-v2-source-review-01/review.json \
  --enabled 0 --timeout 1800000 --output artifacts/m3b-context-recovery-v2-off-01
# Repeat serially with --enabled 1 and fresh artifacts/m3b-context-recovery-v2-on-01.

python3 -B scripts/with-tmp.py -- node tests/m3b-context-recovery-v2/inspect.mjs \
  --run artifacts/m3b-context-recovery-v2-on-01 \
  --output artifacts/m3b-context-recovery-v2-inspection-on-01
```

`DEFUSS_VM_CHROME` must identify the reviewed Chrome binary. Keep an external
owned-process deadline for stuck I/O/teardown. All scratch uses project `tmp`.
