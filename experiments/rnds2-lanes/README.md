# RNDS2 scalar-lane investigation

This is an isolated experiment above the retained RNDS2 baseline, following
the [version-pinned engine study](../../research/engines/README.md). It changes
the representation inside the existing pure instruction lowering. It does not
change guest code, generic helper ABI, TCI, admission thresholds or VM limits.

The original uses four packed i64 state locals. V1 uses eight i32 locals and
eight i32 input loads. Native-code inspection motivated V2: keep the original
four i64 loads, unpack each word once, and use the eight i32 locals for the
two rounds. Both variants cache the private destination pointer. The extra
locals are declared only in RNDS2-bearing TBs and never cross an unwind.

| Version | Source | Emitted instructions / bytes | State |
| --- | --- | ---: | --- |
| Retained original | `engine/qemu` | 216 / 351 | Reference runtime unchanged |
| Lanes v1 | `artifacts/rnds2-lanes-source-01` | 149 / 267 | Both builds passed; no VM timing selection |
| Lanes v2 | `artifacts/rnds2-lanes-source-02` | 165 / 283 | Selected for full-VM validation and fresh timing |

Read [DESIGN.md](DESIGN.md) and [DESIGN-v2.md](DESIGN-v2.md) for prospective
contracts and selection. [Code-generation results](../../research/engines/lane-codegen-results-01.md)
separate Wasm bytes, actual forced-tier Node native code, missing Chrome
disassembly and performance claims. Each emitter passed 20,480 independent
arbitrary-state component checks, with all five pointer-alias partitions.

The selected pipeline uses `prepare-v2.py`, `diagnostic-v2.py`,
`fixture-run-v2.mjs`, `validate-v2.py` and
`benchmarks/harness/rnds2-lanes-v2-timing/`. The v1 pipeline remains preserved.
Diagnostics and timing use different binaries. All scratch belongs in
`defuss-vm/tmp`; source/builds, failed attempts and raw evidence have durable
artifact paths. No candidate has been promoted.
