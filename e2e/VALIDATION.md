# E2E migration validation — 7 November 2026

The port is validated on the local macOS host with Node 26.11.1 and Chrome
157.0.8103.38. These are correctness checks, not a performance promotion.
The retained RNDS2 runtime remains the default and its bytes are unchanged.

| Check | Actual outcome | Evidence |
| --- | --- | --- |
| Generated BIOS guest | Passed: 43 locally served resources, cross-origin isolation, shared memory, FatFs WASM validation, firmware boot, VGA marker, exact seven-key echo before/after tracing, nonempty trace, no browser errors or failed resource requests | [smoke.json](../artifacts/e2e/port-smoke-09/smoke.json), [screenshot](../artifacts/e2e/port-smoke-09/guest.png) |
| Win98 full runner | Passed: 1024×768 desktop, warm-up, two measured Notepad cycles, one trace cycle, seven trace samples, browser/server teardown | [run.json](../artifacts/e2e/port-win98-03/run.json), [benchmark.json](../artifacts/e2e/port-win98-03/benchmark.json), [screenshot](../artifacts/e2e/port-win98-03/baseline-notepad.png) |
| Serial comparison runner | Passed with retained RNDS2 and the consolidation's rebuilt x86-64 runtime, one guest at a time; each boots Win98, warms up, completes one baseline cycle and closes | [comparison.json](../artifacts/e2e/port-compare-01/comparison.json) |
| Failure/success cleanup | Passed: both HTTP and CDP endpoints reject connections after the two failed and three successful automated runs | [cleanup](../artifacts/e2e-cleanup-verification.json) |
| Fresh output protection | Passed: reusing an existing profile is rejected and its prior report hash remains unchanged | [check](../artifacts/e2e-fresh-output-verification.json) |
| Original disk preservation | Passed: full SHA256 and nanosecond modification time unchanged after all Win98 runs | [check](../artifacts/e2e-disk-preservation.json) |
| Source/runtime preservation | Passed: original import checks and all 73 frozen consolidation report/harness/manifest hashes unchanged | [core import](../artifacts/e2e-core-verification.json), [static checks](../artifacts/e2e-static-verification.json) |
| Port source provenance | All 55 original source inputs match; 16 existing modules reused, 28 files copied, 11 adapted | [import manifest](../manifests/e2e-import.json) |

The final [validation manifest](../manifests/e2e-validation.json) records report
and current code hashes. All 53 E2E/shared-browser JavaScript modules passed
syntax checks. Screenshots were inspected for the actual Notepad and text guest
states. Original root scripts/pages remain untouched.

## Corrections and retained failed attempts

All earlier attempts remain in `artifacts/e2e/`:

- `port-smoke-01`: the initial sandbox denied binding a localhost server;
  subsequent browser checks used the approved local execution context.
- `port-smoke-02`: a display-label assertion did not allow the localized comma
  in “1,500”; corrected without changing the selected JIT setting.
- `port-smoke-03`/`04`: the new URL layout missed the generated pthread glue's
  `../graphics.mjs` and audio imports. The server now mounts runtime files below
  `/host/browser/runtime/`, preserving the sibling layout and binary identities.
- `port-smoke-05` initially passed a weaker keyboard check. Its screenshot
  exposed a missing first character. `06`, `07`, and diagnostic `debug-08`
  retained the stricter failed assertion. The cause was the harness: this
  Playwright version's `waitForFunction` does not poll an asynchronous predicate;
  the test sent input before the awaited QMP readiness read had completed.
  The final test polls awaited `page.evaluate` calls on the host, accepts exactly
  seven keys, halts the generated guest, and verifies the complete echo again
  after tracing. No emulator change or relaxed text assertion was needed.
- `port-win98-01`/`02`: the old GUI shortcut assumption occasionally left
  Notepad open after Alt+F4. The runner now retains the old ten-second settling
  interval, holds shortcut/Enter keys for 70 ms, and permits up to three close
  attempts while recording their count and full elapsed time. The window-close
  assertion remains required. A separate `port-win98-debug-01` input audit and
  successful diagnostic benchmark are retained; its browser was deliberately
  closed through CDP after inspection, so its owner marked the session failed.
  It is excluded from the final automated success set.

## Limits

- The Win98 checks assume the existing English 1024×768 installed image. They
  are a desktop/Notepad regression check, not complete Windows compatibility.
- Manual DOS, drag, storage-copy and Explorer helpers were ported and syntax
  checked; their individual workloads were not all replayed in this migration.
- Audio/worker dependencies load and SB16 is enumerated during Win98 boot;
  audible output, recording, disk growing, host-folder synchronization, and an
  external native disk bridge were not separately exercised.
- The current shared adapter reports PPM transport for this paged-disk GUI path.
  The historical direct-RGBA versus PPM campaign is not reproduced here.
- No fresh statistical speed claim follows from the timings, retries, or the
  two-runtime comparison. Bun and ARM64 validation remain in their existing
  runners and were not redundantly rerun for these added UI files.
