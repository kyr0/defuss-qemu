# M3b budget-1 dispatch fusion: implementation contract 01

Status: source-grounded implementation work in progress, with no generated-code
or guest acceptance. This is a new decision alongside the unchanged
`m3b-fallthrough-design.md` and its five-condition feasibility review. The
runtime and fixtures for M3a and passive FIFO remain frozen.

The first candidate owns one normal TranslationBlock and two logical blocks,
A followed by B. A has one conditional side exit to the instruction after B;
B ends in a direct backedge to A. Limits remain one ordinary executable RAM
page,32 guest instructions,128 bytes and the smaller original translation
instruction limit. Constants, register values, addresses, trip counts and
expected workload answers are never optimizer guards. The retained40-byte
integer loop is a positive source-shape fixture, not an opcode template.

The untested overlay source now starts formation with a bounded register/immediate-only byte predecode on
the already supplied same-page host code span. It must not read a second page
to decide admission. The ordinary QEMU decoder/lowering remains authoritative;
decoded operands/emitter identity and completed TCG effects are revalidated.
Memory, trapping/unknown helpers, unsupported prefixes/modes, plugins, debug,
icount, RF/TF/interrupt shadow, AOT and plans reject. Failure after speculation
must discard the entire IR, construct a fresh DisasContext and call
tcg_func_start before one ordinary retry with the original max_insns. Existing
page-lock retry code -3 retains its original meaning.

Condition preparation may change lazy flags. Continuation bookkeeping must be
saved after gen_jcc/gen_update_cc_op and restored only for the justified
is_jmp/pc_save/cc_op fields. Internal B entry needs its own pending-exit check
and exact B EIP/lazy flags on that path; the shared original exitreq label
cannot represent B. Admission requires CF_PCREL because fixed-PC synchronization
otherwise overwrites an internal exit's EIP. The original ordered insn_start
records, code span, search encoding and restore_state_to_opc remain authoritative.

Budget1 must use an ordinary completed-TB return, not TB_EXIT_REQUESTED without
cpu_exit: cpu_loop_exec_tb treats a request without a pending exit as icount
exhaustion. The closing path must also avoid tcg_wasm_out_goto's same-TB loop.
Side exit and closing backedge require distinct slot bookkeeping. The exact
forced-return implementation must preserve jump-reset/link validity; simply
omitting goto_tb while reporting IDX1 needs a source audit before acceptance.

M3a's M3_LEGACY branch calls the same generated function, so it cannot safely
execute rejected fused IR. Fusion requires a distinct identity/eligibility
guard before both compiled and TCI execution. TCI goto_tb/goto_ptr can chain
internally without returning through the outer dispatcher, so these paths
also need to return to the guarded entry for a fused target. One owning TB is
distinct from two logical blocks; normal descriptor generation, invalidation,
instance ownership and hard12000/pending-GC charging remain unchanged.

Service accounting must distinguish an early A side exit from entry into B.
The proposed bounded debt is one logical B turn, including a pending-exit
check at B. It is consumed at the existing outer service boundary after the
generated/interpreted call has returned, with at most one B body of lag.
The counter threshold must not be skipped and no new yield may occur inside
guest helper context. Exact clearing/consumption across real Asyncify rewind
is a required fixture. Baseline cold TCI chains can bypass outer trysleep;
therefore logical-turn counters and actually executed service calls must be
reported separately, with the chosen debt semantics fixed before a build.

Single CPU is insufficient to exclude independent code writes. The current
application profile uses -nodefaults, PC/acpi-off, kernel/initramfs and two
serial channels, with no explicit NIC/disk/device addition. PC built-ins still
include PCI/ISA bridges, IDE and DMA controllers; -nodefaults alone is not a
proof. The exact realized device graph, unregistered DMA callbacks and later
device changes require a concrete source-enforced guard. Until that guard is
established, production eligibility must remain rejected. A separately named,
bounded diagnostic opt-in is acceptable only with an audited device profile;
it is not a general concurrent-DMA or dormant-fiber safety claim.

Before any performance screen, real fixtures must demonstrate selected fused
code in their own ranges, both Jcc outcomes, varied register/immediate programs,
ordinary direct B entry, exact full state/flags at all three exits, both service
boundaries, every rejection/retry path, alias/overlap invalidation, stale owner
and instance recovery, natural retirement/reinstantiation and exact service
debt. Native contract tests and source preparation alone cannot close those
gates. All scratch belongs under project tmp.

The saved first implementation uses slot0 for A's side exit and slot1 for the
closing backedge. It emits the ordinary goto_tb metadata in both cases, then
suppresses only slot1's actual chain in the Wasm emitter and TCI interpreter.
The following exit_tb retains ordinary IDX1 return semantics. Incoming cold-TCI
goto_tb/goto_ptr paths return to the outer fused guard before admission. The
guard checks descriptor/owner eligibility for both tiers; cached fused
instances check generation even when the independent M3a selector is off.
Partial rejected IR never appends a duplicate slot0 exit. The translation
driver restarts tcg_func_start with the original instruction limit once;
code-buffer errors -1/-2 can use that same ordinary retry, while -3 is unchanged.

The native diagnostic profile rejects the ordinary production profile. It
requires an exact observed device graph, private single memory-backend-ram
path/type,512MiB/maxram equality/no slots, one fixed boot CPU, effective ACPI
off, USB off, HPET absent and effective APIC vAPIC disabled. An actual older
OFF observation exposed kvmvapic, whose APIC delivery path can write guest RAM;
that graph is not admissible. The revised diagnostic CLI adds
`-global apic.vapic=off`. Native checks require one CPU-owned APIC, a disabled
vAPIC control bit, null vAPIC device and zero vAPIC address; the central enable
API is fenced before assignment. IOAPIC routing must use address_space_memory
so its reviewed fixed high APIC destination cannot reach admitted low RAM.
The graph contract is currently empty and enabled
configuration returns-3. The planned OFF-only observation uses the preserved
M3a runtime; a later fresh guarded runtime must independently reproduce its
approved graph. Observation does not prove the lifecycle fences.

The new source fences realization/unrealization, reparenting, unplug and block
backend creation/insertion/attachment before mutation. Block allocation is a
non-fallible API, so a forbidden call fails through error_fatal rather than
returning an unexpected NULL. A narrow QMP command allowlist applies from
profile selection, including rejection of out-of-band calls. HMP object
creation, GDB, qtest, all incoming channels (including CPR), loadvm and replay
reject before activation. Startup must be stopped; all later system-reset
requests, including subsystem reset, become shutdown in this diagnostic
profile. Only final vm_shutdown permits teardown; an ordinary pause does not.
Unexpected unrealized objects or a repeated graph freeze reject eligibility.

Before reading bytes, an RCU-protected RAMBlock lookup must identify the exact
frozen main RAM MemoryRegion and original translation dependency address. It
rejects ROM/ROMD/device/shared/resizable/file-backed/guest-memfd memory, limits
the physical backing offset to[1MiB,512MiB), and bounds the read within the
already supplied current page. It never probes a second guest page.

Accepted byte shapes are distinct from accepted actual IR.64-bit IMUL can
lower to a multiplication helper; entry-dynamic Jcc can compute flags through
a helper. An owner ending exactly at a page edge has an out-of-page taken side
exit, whose normal QEMU lowering uses a lookup helper. These are prospective
IR-retry fixture cases, not selected fused cases. Memory/oversize/cross-page
byte shapes reject earlier. The fixture oracle must preserve this distinction.

The128word stopped ABI records four exact user-PC watches and separates
predecode acceptance, rejected IR, emitted owners, selected compiled/TCI
entries, B attempts/requests and paid service turns. That does not expose full
intermediate architectural state or prove actual Asyncify rewind. Those gates
remain open. The preceding source revision passed five overlay host contracts,
including actual included service-helper ASan/UBSan execution, exact preparation
anchors and the bounded parser's plain/sanitized checks. New boundary and vAPIC
guard changes postdate those checks and remain untested. No SDK QEMU build or
guest execution has validated this draft.

The separate256word boundary bank now stages a default-disarmed, bounded
one-call observation: actual compiled A entry, actual IDX1 return or an
explicitly forced private B requested exit, followed by an equal post-service
snapshot. It captures16GPR/EIP/computed and raw lazy flags plus listed
control/segment fields; it is not a complete intermediate FP/XSTATE dump.
The forced request does not establish natural interrupt arrival. Scalar
request tokens, one-shot counts and exact debt deltas reject duplicate or
abandoned capture callbacks. See the separately versioned boundary contract.

A standalone emitted-WASM contract is being prepared from the exact service
helper and unchanged trysleep, compiled by pinned emsdk with actual Asyncify.
Its capacity/GC/CPU stubs are explicit; two real sleep episodes must expose
native unwind/rewind transitions and exact post-resume accounting. It does not
introduce a VM yield or replace owning-worker/natural-pressure evidence.
