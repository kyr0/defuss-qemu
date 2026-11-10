# Stopped code-byte diagnostics

This helper records bytes **after a workload phase has stopped**. It does not
prove which code generation executed during the phase, identify a process from
CR3, identify a JSC tier, or establish that an address still has its historical
mapping. Keep those limits with every disassembly or loop hypothesis.

`capture.mjs` exports:

```js
const capture = await captureStoppedCode({
  profile,                  // decoded revision1 M1 profile
  registers,                // stopped CPU0 HMP `info registers` text
  readPhysical,             // async (Number physicalAddress, Number bytes) => Uint8Array
  ramBytes: 512 * 1024 * 1024,
  maxEntries: 8,            // 1..16
  bytesPerEntry: 128,       // 1..256
});
```

The caller must keep the single vCPU stopped for the whole capture and record
the diagnostic boundary separately from the workload endpoint. The companion
`physical.mjs` provides the QMP/FS adapter; the walker itself never resumes the
VM, writes guest memory, or changes page-table accessed/dirty bits. The supplied
RAM layout must be the fixed PC/512 MiB configuration used by M1. Physical reads
are restricted to `[1 MiB, 512 MiB)` to avoid low-PC device/ROM regions and all
addresses outside the verified ordinary RAM window. This is not a general
QEMU-machine memory classifier.

The candidate selector takes the highest-estimate compiled-user PC, then both
endpoints of the highest-estimate compiled-user edge, and continues alternating
ranked PC/edge entries. It deduplicates by PC and raw CR3. It retains selection
reasons; estimates are for read selection, not additive cost attribution.
Interpreted/kernel keys and edges with either endpoint outside compiled-user
execution are excluded. Saturated, unsupported-worker and revision0 profiles
are rejected before reading memory.

The walker requires CR0.PE/PG, CR4.PAE, EFER.LME/LMA and four-level paging;
LA57 is rejected. It uses each sampled raw CR3, with PCID/cache bits handled
according to the **current stopped** CR4. It records whether that raw CR3 equals
the stopped CPU's CR3. A mismatch remains readable as an explicit page-table
root request; neither equality nor successful translation establishes process
ownership or that the root has not since been reused. The current mode also
does not prove a historical mode at every sampled entry.

Each read walks PML4/PDPT/PD/PT entries with exact uint64 arithmetic, checks
present/user/execute permissions at every level, and rejects unsupported or
reserved forms. Huge-page addresses support 2 MiB and 1 GiB leaves, including
their distinct PAT bit. Reads spanning a 4 KiB boundary walk the next virtual
page independently and may join noncontiguous physical ranges. Only requested
physical bytes are read, even when a huge page covers a larger range.

Rows retain page-entry addresses, values and raw little-endian bytes, virtual
and physical ranges, code bytes and SHA256 for complete captures. Failure at
any level produces an unresolved row with its partial walk/segments and no
complete-code hash. Global unsupported mode produces an unresolved report.
The hard limits imply at most 160 physical-read attempts and 5,120 requested
physical bytes per capture. `physicalReads`/`physicalBytes` count attempted
callback reads, including a failed callback, not successful-transfer totals.

The implementation follows the retained source:

- [`excp_helper.c`](../../../engine/qemu/target/i386/tcg/system/excp_helper.c):
  `mmu_translate` four-level walk, permissions, huge-page reserved-bit checks.
- [`cpu.h`](../../../engine/qemu/target/i386/cpu.h): page/control-register masks.
- [`cpu-dump.c`](../../../engine/qemu/target/i386/cpu-dump.c): HMP register format.
- [`machine.json`](../../../engine/qemu/qapi/machine.json): `pmemsave` QMP schema.

Run lightweight checks with:

```sh
node --test benchmarks/harness/code/*.test.mjs
node benchmarks/harness/code/check-runtime-fs.mjs \
  artifacts/m1-profile-build-02/runtime/x86_64/qemu-system-x86_64.js \
  artifacts/fresh-fs-check.json
```

Synthetic page-table tests establish walker bounds, address arithmetic,
permission rejection, cross-page handling and hashing. They do not substitute
for an actual stopped-guest capture. Keep any such live report and its source
hashes separately from the frozen M1 baseline/off/on campaign.

The first live inspection campaign retained 104 unresolved rows per run because
the pinned Emscripten runtime rejects Node's `wx` open-mode string. The adapter
now uses the runtime's numeric `O_WRONLY | O_CREAT | O_EXCL` flags (193).
`check-runtime-fs.mjs` loads the actual runtime without starting a guest and
verifies exclusive creation, collision preservation and cleanup with its real
FS implementation. QMP is stubbed in that check; the fresh Chrome campaign is
still required to validate physical reads. The original sources and failed
inspection evidence remain under `artifacts/m1-code-source-01/` and
`artifacts/m1-code-campaign-01/`.
