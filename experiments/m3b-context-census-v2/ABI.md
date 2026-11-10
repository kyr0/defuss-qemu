# Census ABI2 draft

This is a new diagnostic-only overlay on frozen M3b prepared source01. It adds
no guest instruction, yield, chaining change or function reference retention.
Default disabled. No build or execution has been performed.

Exports: `_defuss_m3cc_abi()` returns2;
`_defuss_m3cc_configure(enabled)` chooses0/1 once before first worker execution;
`_defuss_m3cc_status()` returns the atomic state;
`_defuss_m3cc_data()` returns a uint32 bank pointer only at the externally
confirmed prelaunch/paused one-worker profile boundary, otherwise0;
`_defuss_m3cc_watch(slot, pcBigInt, requireFused, nextEpoch)` resets just one slot
while paused and requires the existing M3a/M3b watch to be exactly `[pc,pc+1)`.
PC0 disables a slot independently of the old watch in that slot (the old B
watch can remain active). Global faults/saturation/rejects survive slot resets.
Epoch must be current global epoch+1; duplicates and wrap reject.

The bank has2400 uint32 words, four watches at32, stride592. Header:
0magic0x4d334343;1ABI2;2state(enabled1/chosen2/locked4/writing8);
3sticky fault OR;4saturation;5words2400;6watches4;7offset32;8stride592;
9tupleWords112;10watchEpoch;11API rejects;12total watched attempts;
13active-slot mask;14..15reserved. Words16..31 are typed injection evidence:
16requests,17stale successes,18invalid successes,19rejects,20requestID,
21action,22signed return encoded uint32,23slot,24..25PC,
26..27expected generation,28..29actual generation,30flags,31cflags.

Per-watch header:0..1PC;2active;3requireFused;4reset epoch;5sticky slot faults;
6total attempts;7architectural-RF attempts;8..15 counts indexed
`kind*2+tier`, kinds=fusedNormal0/ordinaryRF1/ordinaryNormal2/other3,
tiers=compiled0/TCI1;16first-tuple mask;17reserved;18last kind;19last tier;
20..23 actual-site counts(compiled/outerTCI/internalGotoTb/internalGotoPtr);
24first-fault kind;25first-fault site;26reserved;27bad-tuple present;
28..31reserved. First tuples are at32+kind*112; first failed tuple is at480.
All count fields saturate and latch overflow. OrdinaryNormal is an error only
when requireFused1; this permits OFF controls and expected-negative programs
without weakening the host's required expectation for positive programs.

Tuple words, all uint64 values stored low then high:
0PC,2owner numeric identity,4generation,6code/header numeric identity,
8translationPC,10page0,12page1 (`UINT64_MAX` absent),14TBflags,15cflags,
16fused,17hflags,18hflags2,19control EFLAGS,
20CR0,22CR3,24CR4,26EFER;
28..57 ES/CS/SS/DS/FS/GS each(selector,baseLo,baseHi,limit,flags);
58GDTbase,60GDTlimit,61IDTbase,63IDTlimit;
64LDT and69TR each(selector,baseLo,baseHi,limit,flags);
74..89 DR0..DR7 pairs;
90..97 raw SegmentCache.flags in ES/CS/SS/DS/FS/GS/LDT/TR order;
98..111reserved zero.
The flags word in each existing segment tuple is canonical access flags:
`rawFlags & 0x00f0ff00`. This retains G/B/L/AVL/P/DPL/S/TYPE exactly.
Selector, full cached base and decoded limit are independent exact fields.
Raw copies retain the original evidence but their duplicated descriptor
base/limit encoding bits are excluded from continuity. See SEGMENT-FLAGS.md.
Owner-specific tuple identity remains exact within each kind except raw-copy words90..97. Cross-kind
context comparison skips0..7 and16, masks only RF0x10000 at14/17/19,
skips raw-copy words90..97, and otherwise compares every retained word including code pages and CR3.
Arithmetic flags, GPRs, lazy CC and CR2 are not continuity fields.

Fault bits:1metadata,2PC,4env/TB flags disagreement,8context,
16tuple continuity,32unexpected category,64worker/profile,128overflow.
The adapter validates a code address through `tcg_tb_lookup` before following
descriptor owner identity. It observes, never executes, the lookup result.
No tuple read follows a failed owner/descriptor validation.

Every actual selected-tier attempt at a watched A is recorded before its
generated generic prologue. Compiled promotion or a fused TCI target returning
to the outer guard is counted only at its eventual execution site. Internal
ordinary TCI targets are counted after promotion declines, before reading TCI.
Thus generic entry aborts are included; existing fused metadata redispatches
before selecting execution remain separate existing counters.

New typed API (old M3a API unchanged):
`_defuss_m3cc_inject(requestID, action, slot, pcBigInt, generationBigInt)`.
It requires enabled M3b, paused single worker, existing exact watch, a clean
selected fused tuple/current compiled instance and the requested generation.
Two region-tree traversals find and revalidate exactly one matching fused
owner before setting its instance generation0 (action1) or descriptor valid0
(action2). IDs1..32 are monotonic; no function/owner references survive return.
Wrong generation, ordinary/RF owner, unknown/repeated ID or ambiguity rejects.
Returns1 success;−1 request/profile/watch/tuple guard rejection;−2 not exactly
one live matching owner;−3 second-pass mutation count failure;−4 invalid/reused
request ID. Guard rejects do not consume an ID. A valid request consumes its ID
before the two traversals, including a subsequent−2/−3 failure. Successful
mutations also update the existing M3a injected-action counters and50..54
metadata; new rejections use only census word19. Do not launch a host reader
until final source review confirms this draft ABI.

ABI2 is incompatible with ABI1 readers. The bank magic,2400word length and
slot/tuple offsets are unchanged. Binding variant is `m3b-context-census-v2`;
extensions are `context-entry-census-v2` and `generation-specific-injection-v1`.
Typed injection semantics and signatures are unchanged. Neither an ABI1 fault
nor an old failed capture is cleared, reinterpreted or accepted by this source.
