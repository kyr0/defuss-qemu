# M3b enabled user-state preservation

Both fresh OFF/ON captures passed **45 gates, 47,168 calls and 943,364 original
register/flags/legacy-state checks per arm**, with digest `2f5b81ae5cb6964b`.
Each call also compared two XSAVE images against seeded architectural state:
94,336 additional image comparisons per arm. All twelve required measured
ON windows had positive compiled fused execution at their exact watched PCs.

The actual guest reported **XCR0=31**, with a 1,088-byte standard XSAVE area:
x87, SSE, YMM, MPX bounds and MPX control/status. All those enabled user
components were checked. PKRU was not enabled in this guest, so the source and
host tests for that component are not live PKRU validation.

The [combined validation](../../artifacts/m3b-xstate-v2-validation-01/summary.json)
rehashes 754 identities. The separate
[Python reconstruction](../../artifacts/m3b-xstate-v2-review-01/review.json)
passed 738 identities, raw serial reconciliation, all original arithmetic
gates, native counter/watch decoding and independent XSAVE byte comparisons.
Both offline JavaScript replays passed:
[OFF](../../artifacts/m3b-xstate-v2-inspection-off-01/review.json) and
[ON](../../artifacts/m3b-xstate-v2-inspection-on-01/review.json).
These new sources and replays were authored by the same root agent; they are
separate implementations, not an externally independent source audit.

## What was exercised

The [new fixture](../../tests/m3b-xstate-v2/README.md) retains the original eleven
integer programs, inputs, warmup and side/body/direct-B batches. Its trampoline
saves the caller's enabled user XSTATE, restores one of two alternating nonzero
seed images, and records the actual restored image. It seeds the original
sixteen GPRs and user flags, enters the selected program, captures registers and
flags before using scratch registers, then saves the resulting XSTATE. The
caller image is restored before returning to C.

Every invocation compares both images with the expected seed, including
defined x87 control/status/tag/opcode/pointers and all eight 80-bit values,
MXCSR, all sixteen XMM registers, every upper YMM half, all four MPX bounds and
MPX control/status. Reserved fields are excluded. The two patterns vary data
and rounding controls, with floating-point exceptions masked. MPX bounds are
nonzero, but bounds checking remains disabled through zero BNDCFGU, as required
by the unchanged native eligibility guard. This does not test fusion while MPX
bounds enforcement is active.

Each stopped gate retains both latest patterns' actual before/after images and
their invocation ordinals. There are 176 noninitial raw state images per arm,
in addition to explicitly empty layout samples. Their serial bytes and stopped
native observations are fsynced before interpretation and guest ACK. The full
serial stream must equal the concatenated journal slices byte for byte.

| Observation | OFF | ON |
|---|---:|---:|
| Original gates / checks | 45 / 943,364 | 45 / 943,364 |
| Calls / seeded-image comparisons | 47,168 / 94,336 | 47,168 / 94,336 |
| Required positive measured fused windows | 0 | 12 |
| Whole-run regions formed | 0 | 4 |
| Whole-run compiled / TCI fused entry attempts | 0 / 0 | 72,630 / 6,000 |
| Whole-run B attempts / service paid | 0 / 0 | 61,478 / 61,478 |
| B requests / debt errors / entry rejects | 0 / 0 / 0 | 0 / 0 / 0 |
| Final pool charge / hard cap | 5,973 / 12,000 | 6,984 / 12,000 |

Counts are attempts, not retired bodies or time fractions. This fixture has no
instruction trace, so it does not repeat the earlier trace/census proof's exact
dynamic body partition. Positive compiled-PC exposure, negative shape controls,
ordinary direct-B selection, and B-attempt/service equality remain mandatory.

## Retained predecessor and provenance

The [first capture](../../artifacts/m3b-xstate-off-failure-01/review.json) rejected
the initial fixture's supported XCR0 profile before any test gate. Its exact
XCR0 was not printed, so that failure alone does not establish the earlier mask.
The source, capture and failure remain unchanged; no ON capture of that revision
was attempted. Revision 2 adds explicit MPX state coverage from the pinned
QEMU XSAVE/XRSTOR implementation and emits XCR0 before the guard. Unknown
enabled components still fail. The successful fresh pair observed mask 31.

The original ABI2 runtime and all native guards remain unchanged. Both arms use
the same new guest ELF and rootfs, one CPU, private 512 MiB RAM, 128 MiB TB
storage, hot limit 1,500, runtime flags 2 and the unchanged 12,000-instance cap.
The actual pinned-SDK fixture build, disassembly, source copies and invocation
were verified before capture. The builder was stopped before both runs, and
owned Chrome cleanup passed after each.

The frozen host source passed seven tests, seven syntax checks and three Python
AST checks. The separate reviewer passed four test methods, including deliberate
corruption of architectural bytes, serial, gates, watch state and ACK ordering.
The [capture source freeze](../../artifacts/m3b-xstate-v2-source-01/manifest.json)
and [reviewer source freeze](../../artifacts/m3b-xstate-v2-review-source-01/manifest.json)
bind these tests and their dependencies.

## Remaining boundary

This establishes return-state preservation for all enabled user XSAVE
components in the observed profile. It does not establish complete native
architectural state at every internal B/budget exit, supervisor/kernel XSTATE,
natural-interrupt state, owning-worker Asyncify continuation, or suspended-owner
and alias-SMC invalidation. Those remain M3b correctness gates.

Both captures are diagnostic and timing-ineligible. Host load remains
uncontrolled; controller wall times establish neither speedup nor deoptimization.
The completed timing pilot and its two repetitions are unchanged. M3b remains
off by default, with uninstrumented resource/performance acceptance still open.

A subsequent [owning-worker service-continuation experiment](m3b-worker-suspension-01.md)
passed four real compiled-sentinel suspension episodes with exact captured state
and single payment. It advances that scoped gate while suspended-owner
invalidation and the other limits above remain open.
