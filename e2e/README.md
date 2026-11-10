# Browser end-to-end tests

These runners and pages are the portable continuation of the workspace's root
Win98 automation. They use the retained RNDS2 x86-64 runtime by default, the
existing `host/browser` implementation, and the local firmware. No previous
demo checkout, external web server, hard-coded Chrome path, or root
`.browser-tools` installation is needed.

Run from `defuss-vm`, after installing the pinned package dependencies with
`npm ci --ignore-scripts`. Point `DEFUSS_VM_CHROME` at an installed Chrome
executable, or use the Chromium installed for Playwright. Every new run needs
a fresh `PROFILE`; reports, screenshots, and traces go to
`artifacts/e2e/<PROFILE>/`. Run guests serially.

## Generated guest: no Windows image needed

```sh
PROFILE=smoke-01 npm run e2e:smoke
```

This starts its own loopback server and browser, checks all local page/module/
worker assets, isolation headers and shared memory, boots a generated BIOS
floppy, verifies VGA text and keyboard echo, and exports a trace with actual
guest samples. It closes the server and browser on success or failure. It does
not establish Windows compatibility or audio/folder bridge correctness.

## Windows 98 boot and GUI check

```sh
WIN98_DISK=/absolute/path/to/installed-win98.img \
  PROFILE=win98-01 npm run e2e:win98
```

The runner starts one browser and an automatically assigned HTTP port, waits
for the historical 1024×768 desktop/teal/taskbar assertions, exercises
Start → Run → Notepad open/close cycles, then exports a light trace. The original
ten-second desktop settling interval is retained. Shortcut/Enter keys are held
for 70 ms to accommodate guest scheduling; this differs from
the historical benchmark's immediate key release and is recorded in its JSON.
Alt+F4 has up to three attempts, like the existing bounded Start-menu retries;
each cycle records `closeAttempts` and includes retry time in `closeMs`.
The final desktop/window assertions are required even when a retry occurs.
Screenshots
and JSON reports are retained. An overall deadline and owned-process cleanup
bound the run. `ITERATIONS` defaults to 3; `TRACE_SECONDS` defaults to 5.
`BASELINE_ONLY=1` omits the instrumented cycles. Timings are diagnostic, not a
new statistical performance result. The existing visual assertions assume the
English, 1024×768 Win98 fixture; other themes/locales need their own assertions.

Windows images remain external fixtures. Loading a raw image uses the existing
in-memory/private paged overlay; guest writes do not change the source image.
The tests never click “Apply to host folder”. No installation media are bundled.

`RUNTIME_DIR` selects a compatible x86-64 runtime directory, relative to
`defuss-vm` or absolute. Default: `runtime/x86_64`. A rebuilt candidate can be
selected as `RUNTIME_DIR=artifacts/build-03/runtime/x86_64`. Every boot records
both JS and WASM hashes. This GUI page is currently x86-64; the ARM64 and i386
checks remain in `tests/`.

Supported environment settings: `HEADFUL=1`, `CPU`, `VIDEO`, `POINTER`, `COMPAT`,
`RAM`, `TB_CACHE`, `SOUND`, `DISPLAY`, `DISPLAY_HZ`, `HOT_LIMIT`, `HELPERS=1`, and
`DEEP=1`. Profiling alters timings; the normal benchmark rejects deep tracing.
`ACK_REPAINT=1` retains the original explicit repaint experiment and is off by
default. `CDP_PORT` defaults to 19223 and must be free. No remote debug port is
used by the generated-guest smoke. `BOOT_TIMEOUT_MS`, `DESKTOP_TIMEOUT_MS`,
`BENCHMARK_TIMEOUT_MS`, and `E2E_TIMEOUT_MS` bound the automated work.

## Serve or hold a VM for diagnostics

```sh
npm run e2e:serve
# Opens no browser; prints http://127.0.0.1:18081/e2e/web/win9x.html.
# PORT overrides the port; RUNTIME_DIR selects the runtime.

WIN98_DISK=/absolute/path/to/installed-win98.img PROFILE=interactive-01 \
  KEEP_OPEN=1 HEADFUL=1 node e2e/win98/boot-win98-v68.mjs
```

The boot script serves its own page. Without `KEEP_OPEN=1`, it exits after the
desktop assertion. With it, use another terminal and the same `PROFILE` to
attach a diagnostic below. `session.json` supplies the actual page URL and CDP
address; a per-boot token prevents attachment to an unrelated reused port.
Ctrl-C in the boot terminal closes that browser, workers, and server.

```sh
PROFILE=interactive-01 COMMAND=notepad node e2e/win98/guest-run-win98.mjs
PROFILE=interactive-01 node e2e/win98/mycomputer-trace.mjs
PROFILE=interactive-01 node e2e/win98/drag-trace.mjs
```

The drag helper assumes an open window with its title bar at the original
fixture coordinates. It records a workload, not an assertion of GUI correctness.
The DOS helpers require an already focused DOS command prompt. They do not
blindly close windows or switch applications:

```sh
PROFILE=interactive-01 TEXT=ver node e2e/win98/dos-type.mjs
PROFILE=interactive-01 node e2e/win98/dos-root.mjs
PROFILE=interactive-01 node e2e/win98/storage-trace.mjs
```

The storage diagnostic creates `TEMP\DLLCOPY` and copies `COMMAND.COM` inside
the guest overlay. Other command helpers type exactly the command supplied.
Diagnostic attachments leave the owning boot process running. Their files are
intentionally reusable within that interactive run; use separate profiles to
retain separate observations.

## Compare explicitly selected runtimes/settings

Create a local JSON file such as:

```json
[
  {"name":"retained","runtime":"runtime/x86_64"},
  {"name":"rebuilt","runtime":"artifacts/build-03/runtime/x86_64"}
]
```

```sh
WIN98_DISK=/absolute/path/to/installed-win98.img \
  node e2e/win98/run-win98-ab.mjs profiles.json comparison-01
```

Each profile runs and closes before the next starts. Optional `env` settings
select CPU, video, RAM, display, sound, cache, JIT promotion, compatibility, or
repaint experiment. Profiles and all settings must be explicit. This replaces
the old hard-coded direct-RGBA/PPM servers; it does not recreate their historical
binaries or provide paired statistical analysis.

The shared browser adapter currently reports PPM frame transport for the
paged-disk Win98 path. The old direct-RGBA-versus-PPM experiment is not silently
recreated by pointing two profiles at the same page.

## Migration map and other coverage

| Original root file | Local continuation |
| --- | --- |
| `boot-win98-v68.mjs` | `win98/boot-win98-v68.mjs`; adds owned server, runtime hashes, fresh output and finite default |
| `boot-win98.mjs` | Superseded by the desktop-asserting boot runner; old timed screenshots remain in the original workspace |
| `benchmark-win98-v68.mjs` | `win98/benchmark-win98-v68.mjs`; same GUI actions and sampling, session-based attachment |
| `run-win98-ab.mjs` | `win98/run-win98-ab.mjs`; explicit profiles, serial owned lifecycle |
| `guest-run-win98.mjs` | `win98/guest-run-win98.mjs` |
| `dos-root.mjs`, `dos-type.mjs` | Matching names under `win98/` |
| `drag-trace.mjs`, `mycomputer-trace.mjs`, `storage-trace.mjs` | Matching names under `win98/` |
| Demo `index.html`, `win9x.html`, `win9x-ui.mjs` | `web/`; local runtime/firmware URLs and direct diagnostic hooks |
| Remaining browser modules, workers, `ff.wasm` | Shared `../host/browser/`; existing modules reused unchanged |

The original Bun workload and ARM64 checks already live in `../tests/`.
The stateful Bun COM1/automatic/manual snapshot browser tests remain in
`../packaging/bun-app/`. Their commands and prerequisites are documented in the
[project README](../README.md#validation); this migration does not duplicate them.

Source hashes, reuse, and edits are recorded in
[the import manifest](../manifests/e2e-import.json). License notices for the
imported demo, FatFs, and ringbuf are under `licenses/`. Original scripts and
pages remain unchanged in the parent workspace. See [VALIDATION.md](VALIDATION.md)
for the tests actually run during this port and their limits.
