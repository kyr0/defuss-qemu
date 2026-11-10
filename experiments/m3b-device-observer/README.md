# M3b OFF-only device observation

This new diagnostic observes the already built, hash-pinned M3a source04 runtime
at `-S` prelaunch. It contains no M3b implementation and explicitly configures
M3 OFF before vCPU startup. It never sends `cont`, changes a QOM property, adds a
device, loads a snapshot or enables fusion. A completed report has status
`observed`, `timingEligible:false` and `eligibilityEstablished:false`.

Source is prepared during a separate timing campaign. **No syntax check, test,
browser, package or guest execution has been performed for this draft.** Run
the following only in a root-coordinated gap, after source review:

```sh
python3 -B scripts/with-tmp.py -- node --test experiments/m3b-device-observer/test-graph.mjs
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -B scripts/with-tmp.py -- node experiments/m3b-device-observer/run.mjs --mode off --timeout 180000 --output artifacts/m3b-device-observation-01
```

The runtime, kernel and source05 fixture image are fixed to the retained M3a
build01/main fixture02 identities. The CLI explicitly uses
`pc,acpi=off,hpet=off,usb=off`, `cpus=1,maxcpus=1`,512MiB,`-nodefaults`,`-S`,
two serial ports and the original kernel/initramfs/ROMs. It preserves the
original128MiB TB buffer and flags2/hot1500 fixture settings. It does not use
the production snapshot adapter. Its regular COM1 input file remains empty;
no guest instructions are requested.

The runner requires that explicit Chrome executable and resolves it before
creating an attempt. It uses the hash-pinned, unchanged sustained-v2
`host-condition.mjs` to require the12GiB `builder` VM to be `Stopped` before
preflight and again after the owned browser closes. The helper source and
Lima executable identities are included in inputs and preflight; raw before/
after command output is retained, and a mismatch makes the observation fail.
These two checks do not establish that the user's other applications were
idle. Root still serializes this diagnostic with all build and timing work.

The read-only QMP allowlist is capabilities negotiation, status, CPUs, device
CPU and memory-backend type catalogues, QOM list/get of named safe properties, query-block and
the exact HMP string `info qtree`. All QOM child edges from `/` are traversed;
link edges are recorded as property metadata but are not recursively followed.
Each realized DeviceState records its actual type, composition parent, path,
hotplugged flag and parent-bus path. Parent buses must occur in the complete
composition traversal. A partially realized device graph fails. The independent CPU catalogue and query-cpus-fast
identity must agree. Effective ACPI/HPET/USB, RAM and maximum CPU properties
are checked, and prelaunch status is checked before and after observation.
Exactly one `memory-backend-ram` must be linked to the machine with512MiB and
`share:false`; extra backends, RAM slots and a larger maximum RAM size reject.
This closes an observation gap in a DeviceState-only graph: host memory
backends are QOM objects, not DeviceState nodes. The future native profile
must check these facts itself.
Native M3 counters must remain zero and M3 must read back disabled. The native
`started` bit is retained descriptively: it locks dispatcher configuration and
does not by itself count guest instructions.

The observer stores all QMP requests/responses in a bounded, fsynced event log
before advancing to the next command, plus raw QMP output, raw `info qtree`,
the complete graph, source/runtime/input identities and served-file identities.
It verifies the exact retained build/source-recheck/fixture records, all seven
runtime artifacts, kernel/initramfs/ROMs and local source inputs. Inputs are
rehash-checked after the owned browser closes. Output directories and files
are exclusive, failed attempts remain, and browser temporary files require
the project-local scratch wrapper. A fixed deadline, traversal depth/node/
property bounds and byte bounds constrain failures. Page errors and crashes
are fatal; worker console output is retained. The helper closes only its owned browser.
If a host-level fatal race ends evaluation before its result returns, the
browser's final raw QMP tail may be unavailable; the structured requests and
completed responses already fsynced on the host remain. Such an attempt is
failed, and is never reported as a complete observation.

**Hidden backend gap:** `block/qapi.c:qmp_query_block` iterates
`blk_all_next`, but filters backends which are both unnamed and unattached.
An empty visible list is not proof that all BlockBackends are absent. The
report deliberately records `hiddenBackendCount:null` and
`nativeBlkAllNextVerified:false`. QMP tree observation also cannot prove that
future device/property/backend mutation is fenced or that all device writers
are safe. The new guarded M3b runtime must independently enforce its reviewed
exact graph, native all-backend-zero check and lifecycle guards before any ON
eligibility. No allowlist is automatically generated or promoted from this
observation.

The source-only lifecycle conditions are retained in
`artifacts/m3b-device-lifecycle-review-01/review.json`. This diagnostic does not
modify the frozen M3a runtime, production profile0 or any timing input.
