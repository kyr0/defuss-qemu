# Bun comparison: confirm01

Eight paired runs passed. Times below are medians across the eight observations; execution observations are each the median of three 100-call batches. The ratio is the geometric mean of paired WASM/native times, so a larger ratio favors native.

| Measurement | defuss/smol native | QEMU-WASM | WASM/native ratio | Approx. 99.1667% paired interval | Native wins |
|---|---:|---:|---:|---:|---:|
| Cold start to app ready | 0.455 s | 24.378 s | 47.87× | 31.66–57.15× | 8/8 |
| Available launch: native cold / WASM resume | 0.455 s | 2.002 s | 4.09× | 2.60–5.19× | 8/8 |
| Integer, 100 calls | 42.684 ms | 412.893 ms | 12.08× | 9.44–22.34× | 8/8 |
| JSON, 100 calls | 13.039 ms | 2596.640 ms | 199.55× | 193.86–208.55× | 8/8 |
| SHA256, 100 calls | 33.139 ms | 2260.208 ms | 68.80× | 66.02–72.21× | 8/8 |
| Guest-loopback HTTP, 100 calls | 12.729 ms | 4059.900 ms | 316.22× | 297.17–339.26× | 8/8 |

These are host-observed elapsed times, including the acknowledged control transport. Guest clocks are not used for the comparison. The confidence intervals resample all eight launch pairs 50,000 times with seed 20261107, with a six-endpoint Bonferroni family target of 95%. Small-sample coverage remains approximate.

All observations are retained. Pair 1 had a much slower WASM integer median (2.074 s versus about 0.4–0.52 s in the others); pair 2 had a native cold start of 1.318 s versus about 0.42–0.47 s in the others. Their causes were not isolated. They contribute to the reported ratios and wider intervals.

## What was compared

- Host: Apple M5 Max, 18 logical CPUs, 48 GiB RAM; macOS 26.7.1. See [host record](../../host.json).
- Native Linux ARM64 under smolvm 1.32.4 / Hypervisor.framework versus Linux amd64 emulation in the optimized RNDS2 QEMU-WASM runtime.
- Bun 1.4.4 distroless, exact revision `38afee6c84fcf48c0edb2466aa4b27d287a59c30`, one vCPU and 512 MiB guest RAM on both.
- Identical shared bundle: `8da011224d282638f14effc56450e70bddc4459a904c4b4a0c317168ff44cdc9`. The original operations and expected values are unchanged.
- Native image: `sha256:f6e8216146f6cbe9fecaa7a8161876cafee774ef68013e975c7d63183004b934`; WASM guest image: `sha256:b14d4eb5d84af31d532380ad42fbc8243936bbe23e2b85c5f740efbd845fe6f2`.
- WASM binary: `ecfbc2b4efa6cffaf2b1a22e2d511f6a1e429c6f70c98aafe665176712c8bad4`; Chrome `157.0.8103.38`.

## Startup scope and native snapshot limitation

Startup begins with the host controllers already prepared. Chrome/page and daemon process launch, downloads, builds and image imports are excluded. WASM asset handling, backend initialization and application startup remain included. Native readiness uses fresh HTTP polling; WASM readiness is observed on the serial console. Local artifact and filesystem caches are retained.

The eight native observations stop and start the same provisioned machine/disk with fresh VM boots, Bun processes and nonces. Each WASM observation uses a new cold capture and a fresh Chrome/VM restore. Execution follows the same ten-cycle warmup from initialized, pre-workload state. This is fixed-warmup behavior, not proven JIT convergence.

Native `machine pause` rejected this deployed image with: `the initial portable checkpoint profile does not support host-backed image layers`. There is no native snapshot-resume result. The second startup row compares the available native cold path with WASM snapshot continuation. WASM restore ends only when the guest validates its retained nonce, heap, file and continuation ordinal.

WASM durable capture added a median 6.083 s after initialized readiness; retained snapshot files had a median size of 91.5 MiB. Capture cost is separate from both startup rows.

## Control transport and validation

- native: median empty-gate cost across launches 0.179 ms; per-launch p95 range 0.262–0.530 ms; minimum batch/p95 separation 24.95×. No overhead is subtracted.
- wasm: median empty-gate cost across launches 10.381 ms; per-launch p95 range 13.669–37.478 ms; minimum batch/p95 separation 10.88×. No overhead is subtracted.

All 16 measured execution VMs passed 69 acknowledged protocol events each (1,104 total), 12 measured batches each (192 batches, 19,200 checked workload calls), and the fixed warmups (640 additional calls). Every blocked-ACK probe passed. The eight captured snapshots retained their hash, size, timestamp and inode through restore. All native VMs reached stopped state and every browser runner closed.

The coarse ratios compare complete stacks, including different control transports. They do not isolate ISA efficiency or prove percent-level pure-compute gains. Unrelated host processes remained active; alternating order and repeated launches measure variation in this session, not every possible host load.

## Retained evidence

- [Analysis and all pair ratios](campaign.analysis.json)
- [Raw campaign / command hashes](campaign.json)
- [Frozen plan and input hashes](plan.json)
- [Independent verification](independent-review.json): 17,719 checks and 134 file identities passed; all timing aggregates and bootstrap intervals reproduced.
- [Native cleanup](../../cleanup.json): owned applications/VM disks removed and isolated daemon stopped.
- [Reusable commands and source links](../../README.md)
- [Native pause failure](../pilot-native-resume.json)
- [Original unchanged-bundle compatibility pilot](../pilot-native-original.json)

The frozen analyzer originally misresolved workspace-relative engine/helper paths. [analyze-report.py](../../analyze-report.py) corrects only that resolver and records the repair hash in the analysis. Original data, plan, validation and statistical formulas remain unchanged.
