# M3b extended user-state preservation fixture, revision 2

New derivative of the frozen eleven-program differential fixture. The original
integer inputs, 45 gates, 47,168 calls, 943,364 checks and deterministic digest
are unchanged. Source and output paths are separate; the original ABI2 runtime
is used unchanged, M3a enabled, M3b explicitly OFF/ON, hot1500/flags2, private
512 MiB RAM, 128 MiB TB storage and the hard 12,000-instance cap.

Before each call, assembly saves the caller's enabled user XSTATE, restores one
of two deterministic nonzero images, and records the actual restored image.
It then seeds every original GPR/user-RFLAGS input and enters the selected
original A/B path. At return it captures the tested GPRs/flags before scratch
use, saves XSTATE, restores the caller's complete image, and returns to C.
Every invocation checks both images against the seeded state. Both latest
patterns are retained at each guest gate as raw before/after bytes. Layout gate
samples are explicitly zero; later sample ordinals are cumulative N-1 and N.

CPUID/OSXSAVE/XGETBV must admit XCR0=7,31,519 or543. The fixture requires the reported
standard layout (832 bytes for x87/SSE/YMM,1088 with MPX alone,2696 when PKRU is enabled). Unknown
enabled components fail, without falling back to a narrower test. Seeded fields
include x87 control/status/tag/opcode/pointers/eight80-bit values, MXCSR, all16
XMMs, all16 upper YMM halves and, if enabled, MPX bounds/CSR and PKRU. MPX bounds are nonzero; BNDCFGU remains zero so bounds checking stays disabled under the unchanged native eligibility guard. BNDSTATUS contains distinct seeded pointer values. PKRU key0 remains unrestricted;
no mapped page is assigned another key. Defined MXCSR-mask consistency is checked.
Reserved/padding fields are excluded. Both x87 control rounding and MXCSR rounding
vary between patterns, with exceptions masked. Actual component maps are retained.

The host checks all expected legacy gates/results and exact watched A/B tier
exposure. Positive compiled fused execution is mandatory in each relevant ON
batch; negative shapes and OFF retain zero-fusion checks. B-attempt/service
equality remains mandatory. This no-trace fixture makes no F+R+D retired-body
partition claim. The earlier trace/census accounting proofs remain separate.
Raw serial slices and observations are fsynced before interpretation and ACK.
The final serialized stream must equal the concatenated journal slices exactly.

This fixture is return-state preservation for all enabled user XSAVE components
within the declared profile. It does not claim supervisor/kernel XSTATE, exact
state at every internal B/budget boundary, natural interrupt state, actual
owning-worker Asyncify suspension, alias-SMC or performance acceptance. Real
build, OFF/ON runs and offline reconstruction are still required. Same-agent
source checks are not an externally independent review.

Revision 1 rejected the guest XCR0 before all gates; that failed capture is retained. This revision explicitly covers enabled MPX state from the pinned native XSAVE implementation and emits raw XCR0 before the guard. Unknown components still fail. No engine guard or runtime changes.
