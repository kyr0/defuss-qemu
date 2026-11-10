# Separate intermediate-state diagnostic facility

The integrated source has passed its native helper contract under ASan/UBSan
and the JavaScript host fixture checks retained in
`artifacts/m3b-safe-gap-host-tests-03`. Those use explicit host stubs and synthetic
evidence; the QEMU build and real boundary guest remain unexecuted. The
existing128-word ABI1 and45-gate fixture remain separate. No generated-code
result or interrupt-delivery claim follows from these host checks.
`runtime-boundary.inc` is a separate,
default-disarmed diagnostic facility; the diagnostic selector never changes
byte/IR admission or allows a matching PC to bypass ordinary guards.

The host must confirm QMP paused/all CPUs stopped, retain the prior bank, then
call `_defuss_m3b_boundary_arm(request,mode,pc)`. IDs must be consecutive1..32.
Mode1 observes one compiled fused A-to-B backedge return. Mode2 supplies one
private B-request selector, exercising the existing precise B requested-exit
arm. The first matching actual tier claims the request: ordinary or TCI is a
retained failure, not a silently skipped attempt. Missing execution leaves an
armed bank and fails the bounded host handshake. A failed/active request cannot
be rearmed. OFF mode rejects arming; differential guest work remains identical
except for the explicitly recorded requested-exit probe.

The implemented integration sites are:

1. Add a private `uint32_t m3b_boundary_force` beside service debt in
   CPUX86State. It is neither guest memory nor migratable state.
2. Include the new helper after fused-entry validation helpers and before
   `m3b_call_wasm_tb`. Call `m3b_boundary_before` at the final actual compiled
   call boundary and before both TCI branches, including nonfused owners.
3. At the emitted B entry, after ordinary insn_start and the debt1 store,
   load the private force word. Nonzero branches to a private force label,
   stores2 to acknowledge consumption and joins the existing requested-exit
   arm. Natural pending uses the same arm without changing the force word.
   No C helper, sleep or guest-memory access is added to fused IR.
4. An abandoned ACTIVE capture at a subsequent outer dispatch fails and clears
   any leftover private selector. Immediately after a real call returns and before debt payment, copy the
   post-state. Force acknowledgement2 triggers ordinary C `cpu_exit` after
   the generated return; IR never writes CPU pending flags. Require actual
   IDX1/EIP=A/debt1 for mode1, REQUESTED/EIP=B/debt2 for mode2, and no linked
   continuation in ctx.tb_ptr. Early A exits fail rather than being retried.
5. Carry the scalar request token in this outer call's frame into the post-call
   and completion hooks. A nonzero token after COMPLETE fails rather than
   silently dropping a duplicate callback. Pay debt through the unchanged service helper and original trysleep, then
   require one pre/post/completion, exact one service/attempt increment and
   the mode-specific requested increment before release-publishing completion.
   A third state snapshot after service must exactly equal the post-call state.

The capture retains only scalars. No owner/function/instance pointer survives
the call or a later suspension. The before/after native integer state includes
all16GPRs, EIP, computed EFLAGS and every lazy/native flag field. The pure
`cpu_compute_eflags` route passes values to `helper_cc_compute_all`; it does not
call mutating `helper_read_eflags`. The capture also compares original flag
fields afterward. It does not claim a complete FP/XSAVE or system-state dump.

The separate bank returned by `_defuss_m3b_boundary_data()` has256uint32 words:

| Words | Meaning |
|---|---|
|0..7|magic0x4d334253,version1,status,request,mode,failure,wordcount256,snapshot stride64|
|8..13|target A PC pair,descriptor generation pair,B offset,owner bytes|
|14..18|actual return kind,debt before payment,force acknowledgement,compiled flag,snapshot count3|
|19..21|before,after,completion invocation counts; each exactly1 on completion|
|22..27|service before/after,B-attempt before/after,B-request before/after|
|28..31|debt after payment,exact AsyncifyNormal after payment,owner instruction count,reserved0|
|32..95|before-state snapshot|
|96..159|post-state snapshot|
|160..223|post-service state snapshot; all64words must equal the post-call snapshot|
|224..255|reserved0|

Status values are idle0,armed1,active2,complete3,failed4,writer5. Arm returns0
on success; invalid exact RUN_STATE_PAUSED/mode/address -1, inactive policy -2, pending/failed
request -3, nonconsecutive/out-of-bound ID -4. Failure codes1..11 identify TCI,
ordinary owner,ineligibility,dirty diagnostic state,wrong return/debt,wrong EIP,
force acknowledgement,pure flag computation changed fields,invalid cc_op,
service accounting,duplicate hook invocation.

Each64-word snapshot has sixteen u64 registers in fixture order
RAX,RBX,RCX,RDX,RSI,RDI,RBP,RSP,R8..R15 at0..31; EIP pair32..33;
computed EFLAGS34; reserved35; raw EFLAGS pair36..37; cc_dst38..39,
cc_src40..41,cc_src2 42..43; cc_op44,df45,hflags46,hflags2 47;
CS/FS/GS bases48..53; CR0/CR4/EFER54..59; reserved60..63.

The bounded fixture source in `tests/m3b-boundary` warms the same positive
programs, then performs a known nonzero-body A call between stopped gates for
each mode. Its independent oracle compares the captured before/after relation, including
exact A/B EIP and the arithmetic flags after one body or only A, and retain
the complete raw bank. The actual guest execution of that oracle is still
pending; existing final-state tests cannot supply this evidence.
Invocation counts and scalar tokens detect the specified callbacks being
repeated; they are not a general proof that arbitrary compiler replay is
impossible. A successful post-service equality check does not establish that
the VM actually suspended. Forced requested exit is explicitly distinct from a naturally arriving
interrupt. An emitted-WASM Asyncify contract separately exercises the exact
service source with a stubbed capacity predicate; natural VM pressure remains
a separate gate. No forced yield, threshold reset or GC is added to this VM.
