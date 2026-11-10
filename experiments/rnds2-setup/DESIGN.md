# RNDS2 plus early SIMD operand forwarding

Prospective experiment declared before any candidate timing. The user requests
an improvement above the retained RNDS2 baseline following investigation of
the actual V8 and Bun/JSC engines. See research/engines/README.md.

The production source changes three files relative to engine/qemu. It ports
the existing setup selector/allocator for PSHUFB XMM/YMM, min/equality/mask
onto the RNDS2 tree. The RNDS2 emitter and all generic helper paths remain.
No M2/M3 fusion, graph bookkeeping or diagnostic counters are included.
The separate check build adds selector/metadata selftests and five compiled
execution counters. It is excluded from timing. The earlier setup screen used
a different baseline and supplies no performance conclusion here.

Before timing require selector and metadata checks, the 20,480-check setup
guest with compiled and fallback exposure, wider PSHUFB alias/memory coverage,
and the 28,672-check RNDS2 guest on the new production build. Original fixture
images may be reused with exact retained identities: it is the new runtime
being tested. Retain raw serial and per-gate counters. Failures halt.

Timing uses four independent cold matched three-arm blocks, twelve fresh Chrome launches.
Order alternates original/control/candidate and candidate/control/original.
Control is a fresh unchanged RNDS2 source build with the identical SDK and
x86-only command; it separates rebuild effects from the SIMD change. All run the unchanged original M1 Bun/rootfs package,
1 vCPU, 512 MiB guest RAM, 128 MiB TB pool, 12,000 instance cap, hot limit 1,500,
runtime flags 3. Each has ten warmup cycles then three 100-call batches of each
integer/JSON/SHA/HTTP workload and the same 69-gate protocol. No snapshots.
Keep the accepted 30-minute inner deadline and 35-minute outer deadline.
Stop the SDK builder before all captures; serialize captures. Retain every
failure and every sample, with fresh outputs and fsynced journals before ACK.

The primary metric is JSON (the selected SIMD operations target native string
work); report integer/SHA/HTTP, readiness, full horizon, pool and host state
as well. Per launch aggregate each workload's three batch times by median;
within each block divide candidate by original, candidate by rebuilt control,
and rebuilt control by original. Report geometric mean and
nominal marginal 95% log-Student-t interval, df=3, across the four independent
blocks. Values below 1 mean faster. Four blocks are exploratory; no automatic
production promotion or unchanged-native-gap claim. A promising result needs
independent confirmation and resource acceptance. It is not enough to beat
M3b, or to compare a new cold run against old restored timings.

The harness derives from the accepted m3b-timing lifecycle and corrected
raw-byte analyzer; the candidate has no M3 API, so its native status must be
null in all arms. Freeze source/runtime/package identities before launch.
Reconstruct results from raw journals using Python and replay the JS protocol.

After freezing, one separate diagnostic run uses the exact unchanged M1 Bun
package and the check build. Five setup counters are read only at stopped
gates to establish actual per-workload exposure. It is excluded from timing
comparisons and must pass the same guest result/lifecycle oracle. The timing
schedule contains only original/control/candidate; diagnostic is never an
additional statistical sample.
