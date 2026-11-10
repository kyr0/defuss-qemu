# ARM64 Linux guests on the WASM host

The separate `aarch64-softmmu` target now builds with pinned internal FDT. The current candidate is **`arm64-stack-18/runtime`**. It boots Linux with normal-sized translation blocks and active JIT, using an ARM64 direct-chaining workaround and explicit 1 MiB guarded worker stacks. The default build target remains `x86_64-softmmu`.

## Reproduce

Use the pinned SDK and existing Lima VM documented in `README.md`. From the workspace root, with the retained audited DTC archive:

```sh
# Use a fresh output directory; the wrapper preserves prior builds.
native-build/build-arm64.sh native-build/arm64-new

# Regenerate the test initramfs and raw Image from retained Alpine inputs.
python3 native-build/prepare-arm64-smoke.py

# Choose fresh report labels to preserve earlier evidence.
node native-build/test-arm64-linux.mjs native-build/arm64-stack-18 new-node-report
ARM64_KERNEL=vmlinuz-virt node native-build/test-arm64-linux.mjs native-build/arm64-stack-18 new-zboot-report
node native-build/test-arm64-browser.mjs native-build/arm64-stack-18 new-browser-report
```

The Node and Chrome runners default to the raw `Image`. Both accept `ARM64_KERNEL=vmlinuz-virt`, impose a 300-second deadline, and retain JSON and guest serial logs. Chrome runs with a temporary localhost server, cross-origin isolation, shared memory, and isolated headless browser processes that close after the test.

Dry runs work without an SDK and create no output directory:

```sh
python3 qemu-wasm-win9x-v0.6.8/demo/tests/v67/build-experiments/build.py \
  --source native-build/qemu-11.1.3-wasm --output native-build/dry-arm64-new \
  --profile simd --target aarch64-softmmu --dry-run

python3 -m unittest discover \
  -s qemu-wasm-win9x-v0.6.8/demo/tests/v67/build-experiments -p 'test_*.py' -v
```

All nine build-driver/dependency tests pass, including ARM64 stack settings and preservation of default x86 settings. Evidence: `arm64-stack-18/build-driver-tests.log`.

## FDT integration and provenance

The old `--enable-fdt --disable-download` combination selected system FDT discovery, which failed. Adding `-L` to `c_args` then caused DTC compilation to fail with `-Werror=unused-command-line-argument`. The driver now uses `--enable-fdt=internal`, keeps downloads disabled, and removes external FDT include/library flags. DTC uses QEMU's wasm64, pthread, and SIMD configuration. Meson supports [preexisting subprojects without downloading them](https://github.com/mesonbuild/meson/blob/master/docs/markdown/Subprojects.md).

All 310 prepared DTC files match QEMU's pinned upstream revision `b6910bec11614980a21e46fbccc35934b671bd81`. The archive SHA-256 is `e115f987eec23a1ba25150a46ced1675de3716072d3b4905afb3a9cda0f007c7`. `prepare-arm64-fdt.py` verifies the checksum and wrap revision, materializes a missing tree, and refuses to overwrite differing local sources. Materialization, verification, and changed-file refusal were exercised. See `arm64-test-assets/dtc-provenance.json`.

The guest uses retained official [Alpine ARM64 boot assets](https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64/netboot/) and matching `linux-virt-6.12.115-r0.apk`. The APK kernel matches the downloaded kernel exactly. `prepare-arm64-smoke.py` extracts the raw Linux `Image`, replaces `/init` with the test, and adds the matching NVMe modules omitted from Alpine's initramfs. Input/generated hashes are in `arm64-test-assets/linux-provenance.json`. Upstream branch URLs are mutable; reuse the retained, hashed inputs for exact repeats.

## Runtime correctness findings

**Direct chaining:** Attempt 13 completed configuration in 346.54 s and compilation in 532.11 s, then exposed a Linux stack-canary panic in `tmigr_requires_handle_remote`. Both raw and compressed kernels reproduced it. A guarded bare-metal `memset` test passed 10,000 iterations; one-instruction TBs and disabling direct `goto_tb` chaining each passed the Linux/storage test. The narrower no-chaining control passed in 24.72 s with normal-sized TBs.

`0042-arm64-wasm-no-direct-chain.patch` sets `CF_NO_GOTO_TB` for AArch64-capable ARM CPUs on Emscripten. Normal TB sizes, indirect lookup, and JIT remain enabled. This is a correctness workaround, not a repair of the backend's direct-chaining implementation. Attempt 14's failed use of a target-only macro is retained; attempt 15 compiled the corrected runtime CPU-capability check.

**Host worker stack overflow:** Attempt 15 had successful Node and Chrome boots, but repeated tests trapped during virtio initialization. An exact-hash symbolized relink (`arm64-symbols-16`) identified `qemu_in_coroutine`, called by `blk_getlength` and `virtio_blk_update_config`. JS-only instrumentation caught SP **569670912**, below stackLow **569672032** by **1,120 bytes**, outside the **65,536-byte** worker stack. Evidence: `arm64-diagnostic-17/stack-overflow-evidence.json` and `verification-stack-2.json`. This failure affected both kernel formats.

The ARM64 build driver now links with:

```text
-sSTACK_SIZE=1048576
-sDEFAULT_PTHREAD_STACK_SIZE=1048576
-sSTACK_OVERFLOW_CHECK=2
```

These reserve 1 MiB for the main/proxied-main and newly created worker stacks and check stack-pointer assignments. See the [Emscripten settings reference](https://emscripten.org/docs/tools_reference/settings_reference.html#stack-overflow-check). The x86 default flags are unchanged. Attempt 18 relinked the existing objects with these settings in 128.68 s. Its generated runtime contains the stack-check handlers.

A separate guarded-stack control with direct chaining restored (`arm64-chaining-19`) still panicked in the guest stack-canary check, this time in `__of_parse_phandle_with_args`, after 2.59 s. See `verification-direct-chaining.json` and its serial log. The host stack settings did not remove the chaining defect, so attempt 18 retains the workaround. This diagnostic control did not modify working sources or baseline objects.

## Validation and artifacts

Attempt 18 passed **five consecutive Node 26.11.1 boots** without diagnostic CLI flags:

| Guest kernel | Runs | Seconds |
|---|---:|---|
| Raw `Image` | 3 | 24.57, 22.51, 22.69 |
| Compressed `vmlinuz-virt` | 2 | 24.58, 29.05 |

Every run passed eight checks: QMP AArch64 identity, Linux userspace, guest virtio and NVMe write/readback, NIC initialization, completion marker, and comparison of both entire 2 MiB disks against independently constructed expected bytes. See `arm64-stack-18/repeat-summary.json`, `verification-linux-{1..5}.json`, and their serial logs. Stack checking remained enabled, normal TB sizes were used, and JIT stayed active.

Chrome 157.0.8103.38 passed all nine checks for both formats: raw `Image` in **19.11 s** and compressed `vmlinuz-virt` in **18.72 s**, with no page errors. See `arm64-stack-18/browser-summary.json`, `verification-browser-image.json`, and `verification-browser-zboot.json`. These checks add browser isolation/shared-memory validation to the Linux/storage/NIC assertions. Attempt 15's earlier browser pass is retained separately. Its first browser attempt failed in the test harness because `TextDecoder` received a shared-memory view; copying serial bytes into a non-shared buffer fixed the harness without changing the runtime.

Current artifacts:

- JS: 189,184 bytes; SHA-256 `12c6d668639b884f0806cc9df2000a1e9a9ca401ce4f0560f712dc4d8d45c093`
- WASM: 22,391,809 bytes; SHA-256 `b6fd37ff481cdd0ab7997117c75e5567c2f9bf77f214ead60e11f0e5a1149fe6`
- Build evidence: `arm64-stack-18/build-report.json`, `report.json`, `link.log`, and `link-with-stack.py`.

Attempt 13's configured build tree supplied the objects for attempts 15 and 18; archived runtime directories remain distinct. `stage-arm64-runtime.py` stages completed artifacts and hashes dependencies. Its caller must verify compilation succeeded and retain the compile/link log; separate relinks pass `--configuration-report` to identify the original build.

## Remaining limits

- Retain the direct-chaining workaround until its defect is repaired and regression-tested.
- These are bounded boot/storage regressions, not a long-running guest soak test.
- Networking is tested through virtio NIC initialization only. The isolated hub has no host-network peer and emits the expected warning. External packet transport and graphical Linux desktops are untested.
- No ARM performance gain or production promotion is claimed. The original x86 control artifact hashes still match their recorded report; its older 58-core/18-video acceptance runs were not rerun here. Residual Windows UI/CPU lag remains unresolved, and the 12K pressure candidate remains an experiment.
