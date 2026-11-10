# M3b budget1 diagnostic draft ABI1

This describes unbuilt source. It is not a timing runtime or an accepted graph
contract. Root's focused host checks and exact preparation anchors passed at
`artifacts/m3b-safe-gap-host-tests-02`; no emitted guest-code/Asyncify acceptance
is implied. The separate `BOUNDARY.md` draft is newly integrated, untested and does not alter
this bank. All watch reads/configuration require the host to confirm QMP reports
both `running:false` and `status:paused`; main-thread reads cannot establish
that boundary by themselves. No setting or watch is changed while executing.

`_defuss_m3b_configure(enabled,profile)` is one-time and must precede QEMU
startup. Values are0/1; profile0 is ordinary and rejects enabled1. Profile1 is
the separately bounded diagnostic machine profile. Current unpinned source
rejects enabled1 with-3; bad values return-1 and already chosen/locked returns-2.
The machine freeze and configuration share one atomic word. Default is off.

`_defuss_m3b_status()` returns bit0 enabled,1 chosen,2 locked,3 diagnostic
profile,4 graph ready,5 eligible and6 latched runtime fault. Only enabled plus
all chosen/locked/profile/ready/eligible bits and no fault permits formation.
Published graph contents never change after the first freeze. A repeated
freeze faults the profile. Ordinary stop/cont never unlocks it.

`_defuss_m3b_graph_data()` and `_defuss_m3b_graph_size()` expose immutable UTF-8
rows once ready: device path, exact type, QOM parent path and parent-bus path,
separated by tabs, one row per line sorted by bytewise path. Bounds are128
devices and128KiB. Unrealized devices, duplicate paths and overflow reject.
The native profile separately checks the exact pinned private memory-backend
path/type/size/share state and machine properties; a device graph alone does
not prove those properties.

`_defuss_m3b_objects_data/size()` separately expose sorted direct `/objects`
children as path/type tab-separated rows, bounded to32 entries/16KiB. Those
rows have their own exact pin. All explicit user object options reject before
construction; only the observed programmatically created RAM/QMP/etc. objects
can remain. QMP object creation or property mutation is forbidden.

The correctness fixture separately pins hotness1500, admission flags2 and a
128MiB TB buffer in both arms. Those settings are not a new native DMA guard:
the existing admission/retirement algorithms and TB ownership remain unchanged
for their supported values. Native entry still requires the unchanged12000
instance budget. Changing those fixture settings requires fresh evidence; the
current diagnostic results cannot transfer to production flags3 or another
buffer size. Legacy configuration exports retain their pre-vCPU-only contract.

`_defuss_m3b_data()` returns128 uint32 words. Words0..12 are magic0x4d334231,
ABI1, status snapshot, reason bits, saturation flag, budget1, maximum32
instructions, maximum128 bytes, header byte size, watch offset32, watch
stride20, watch configuration epoch, and watch count4. Words13..15 and30..31
are reserved. Reason bits0..6 mean unpinned graph, graph mismatch, topology,
memory/block backends, machine profile, runtime fault and graph overflow.
Counts saturate; any saturation rejects accepted evidence.

Global words16..29 count, in order: predecode-accepted trials, accepted
frontend IR, clean ordinary retries, fused entry rejects, selected compiled
entries, selected cold-TCI entries, attempted B entries, requested exits at B,
paid B service turns, debt errors, cold-TCI returns to a fused target guard,
forced cold-TCI closing returns, completed-IR rejections, and emitted fused
owner descriptors. Emitted descriptors precede ordinary search publication;
they are not by themselves evidence of later execution.

`_defuss_m3b_watch(slot,begin,end)` resets one stopped-only watch. There are four
slots; canonical user ranges must be ordered and contained in[0x10000,2^47].
The pair0,0 disables a watch. Each20word slot has:

| Offset | Meaning |
|---|---|
|0..3|begin low/high, end low/high|
|4..8|compiled entries, TCI entries, B attempts, B requested exits, service paid|
|9..14|accepted predecode, rejected IR, emitted owners, entry rejects, clean retries, forced TCI backedges|
|15|reserved|
|16..19|last selected runtime PC low/high and descriptor generation low/high|

Translation events use their original translation PC; execution events use
actual runtime EIP, including a valid alias. B/service events are attributed
to the scalar entry PC saved before the call, so no owner/function reference
is retained for reporting after the return. Entry counters include the real
entry pending-exit check; they are not instruction-execution counters.

The original M3a API remains present. Differential fixtures configure M3a on
in both arms to retain its separate ordinary-owner exposure. M3b itself does
not rely on that selector: fused instance lookup checks generation even when
M3a is off, and the call boundary validates descriptor, owner, cached function
and generation before the permissive M3a wrapper can execute anything.

Service debt is zero on an A side exit and one turn on attempted B entry;
value2 identifies its requested-exit arm but still owes exactly one turn.
After the call returns, the debt is cleared before invoking the unmodified
`trysleep` decrement/threshold/reset. This adds no helper-context yield and no
forced GC. Cold TCI previously chained internally without these outer service
calls, so its service-call count is intentionally distinguished from baseline.

The current ABI cannot prove full architectural state at an intermediate
backedge return or exact interrupted B entry. Those require a further bounded
diagnostic state hook or a real generated-code fixture. Native counter tests,
ordinary output equality, or an enabled selector must not substitute for them.
