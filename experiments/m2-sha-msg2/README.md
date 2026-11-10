# M2 exact SHA256MSG2 experiment

This isolated candidate directly emits the existing `sha256msg2` helper's four
u32 results. The corrected M1 Bun profiles demonstrate substantial MSG2 helper
exposure. This experiment changes no Bun code, workload inputs, guest loading,
memory translation, RNDS2 lowering, PSHUFB lowering, admission policy or region
formation. No performance result or production promotion is implied by these
fixtures.

## Selection and build

The **switch** build contains an uninstrumented off/on choice. Both modes use
the same JS/WASM bytes; selection occurs once before guest execution. Neither
mode adds a counter or branch to execution of the original native helper. The
only selection check runs during translation. All inherited helper call-stack
argument setup remains in place.

```sh
python3 experiments/m2-sha-msg2/prepare.py --mode switch \
  --output artifacts/m2-msg2-source-new/source
python3 scripts/sdk.py python3 scripts/build.py \
  --source artifacts/m2-msg2-source-new/source \
  --output artifacts/m2-msg2-build-new --targets x86_64-softmmu --jobs 8
```

Outputs must be fresh. The preparer validates exact anchors, copies the source,
and records changed-file and generator hashes in `source-m2-msg2-overlay.json`.
It does not edit `engine/qemu` or retained runtime artifacts. Configuration and
lowering files are copied into the overlay. The optional `--mode diagnostic`
build adds execution counters and is excluded from performance comparisons.

Use the factory's `preRun` hook, or a `noInitialRun` module before `callMain`:

```js
if (mod._defuss_m2_msg2_status() !== 0x10000) throw Error('Unexpected MSG2 ABI/state');
if (mod._defuss_m2_msg2_config(enabled ? 1 : 0) !== 0) throw Error('MSG2 selection rejected');
// status must be 0x10001 (off) or 0x10002 (on) here.
```

ABI1 is encoded in the high 16 status bits. Low states are 0 default/off,
1 selected/off, 2 selected/on, 3 translation-locked/off, 4 translation-locked/on.
One atomic compare/exchange selects a mode. The first helper translation locks
it, including the deferred-emission pass. A selector racing with that transition
either wins before translation or is rejected; it cannot change an already
consumed mode. Duplicate, late or invalid selections return `-1`; success is 0.
Default execution is off. Record requested selection, pre-start and final status
in every run. Do not infer mode from package hash alone or combine off/on runs
without their explicit selection records.

The diagnostic export `_defuss_m2_msg2_counts(clear)` returns a memory64 pointer
to three u64 counters: original-helper entries, compiled-inline executions,
compiled-fallback executions. The last is a subset of original-helper entries;
sum original + inline for total observations. Read/reset only with all vCPUs
stopped. Only single-vCPU diagnostics are supported. These diagnostic counters
are ordinary u64 counters, not saturating counters; bounded fixture runs must
exclude overflow and never use their timings as uninstrumented performance.

## Exact contract

The matcher requires original function identity, the full void/ptr/ptr/ptr
typemask, the exact generated helper name, and a returning helper. Rejected
calls continue through the original helper dispatch. The emitter runs after
the deferred-emission guard. It uses the existing two i64 temporary locals,
one i32 temporary, and R0, which the unchanged helper allocator has already
freed as a declared call-clobbered register. All other TCG register locals remain
untouched. The destination/source pointers still arrive in three eight-byte
call-stack slots.

For `S(x) = rotr32(x,17) XOR rotr32(x,19) XOR (x >> 10)`, the exact writes are:

```text
d[0] = a[0] + S(b[2])
d[1] = a[1] + S(b[3])
d[2] = a[2] + S(d[0])
d[3] = a[3] + S(d[1])
```

All arithmetic wraps to u32. Source reads and destination stores preserve the
original helper's sequential order, including reuse of newly written words.
Equal/disjoint architectural register aliases are supported; synthetic partial
overlaps are also tested against the original helper. Cached pointer arguments
refer to private register/temporary storage, disjoint from the helper call
stack. The path is not a guest-memory accelerator. Guest operands have already
undergone the normal translator loads and fault checks; this change does not
remove those operations. Flags, upper vector lanes, feature gating and guest
fault behavior remain owned by the original frontend.

The operation and opcode were checked against Intel's
[SHA extension definitions](https://www.intel.com/content/dam/develop/external/us/en/documents/intel-sha-extensions-white-paper-402097.pdf)
and [instruction reference](https://www.intel.com/content/dam/www/public/us/en/documents/manuals/64-ia-32-architectures-software-developer-vol-2b-manual.pdf).
Local semantic provenance is `engine/qemu/target/i386/ops_sse.h`,
`helper_sha256msg2`, and the existing helper ABI/register allocator in
`engine/qemu/tcg/wasm64/tcg-target.c.inc` and `engine/qemu/tcg/tcg.c`.

## Host and emitted-WASM validation

```sh
python3 experiments/m2-sha-msg2/test.py --output artifacts/m2-msg2-host-new
node --test experiments/m2-sha-msg2/fixture-check.test.mjs
```

This lightweight test compiles the exact candidate C emitter under ASan/UBSan,
with a small byte-output adapter. Opcode definitions and address/argument
emission helpers are extracted from the retained backend. The original QEMU
MSG2 helper body is also extracted, then executed as the C oracle. No duplicate
JavaScript emitter supplies the candidate instructions.

Node instantiates the C-emitted bytes in actual shared memory64 and memory32
WASM modules. Each width checks 20,480 deterministic arbitrary-input cases,
covering all five pointer-equality partitions, partial overlaps, unsigned edge
words, and unchanged surrounding bytes. An independent BigInt oracle checks
every C result. Sixty extra unaligned cases per width test memory-instruction
alignment hints. Sentinel TCG locals verify that R1–R14 and the R15 call-stack
pointer survive. Matcher rejection and atomic selection races are checked in C.
The modules and report are retained under the fresh output directory.

The host fixture supplies a prepared call-stack local. It does not exercise
QEMU's allocator, guest frontend, asynchronous control flow, feature dispatch,
or real guest exceptions. Those remain integrated guest validation gates.

Initial validation is retained in
[`artifacts/m2-msg2-host-01/report.json`](../../artifacts/m2-msg2-host-01/report.json):
both widths passed, with 161 emitted body bytes for memory64 and 176 for
memory32. This is correctness evidence, not a speed measurement.

## Full-system ISA fixture

Run SDK builds and guests serially with all performance measurements:

```sh
python3 scripts/sdk.py python3 experiments/m2-sha-msg2/build-guest.py \
  --output artifacts/m2-msg2-guest-new
node experiments/m2-sha-msg2/run-guest.mjs \
  --runtime artifacts/m2-msg2-build-new/runtime/x86_64/qemu-system-x86_64.js \
  --fixture artifacts/m2-msg2-guest-new --enabled on \
  --output artifacts/m2-msg2-guest-on-new
```

Repeat in fresh output directories with `--enabled off`, and with `--cold` to
raise the hot threshold to 65,535. The runner uses fixture-only settings that
disable pressure admission, so ordinary hot fixtures can exercise compilation;
this is separate from the unchanged Bun timing configuration.

The guest executes 28,672 explicit SHA256MSG2 instructions over seven register
alias/memory-operand forms. It checks all three seeded YMM registers (including
unchanged upper lanes and non-destination registers), source memory and EFLAGS.
COM1 G/K gates pause the guest before/after each mode. The runner validates all
gates, exact total checks, fixed selected mode, and rejection of a late toggle.
Before the last gate, a separate memory-operand instruction PC is warmed 4,096
times, then its source crosses into a `PROT_NONE` page. A Linux `SA_SIGINFO`
handler checks the exact fault PC/address, `SEGV_ACCERR`, saved and restored
YMM0–2 and flags, and one preceding observable store. The handler resumes after
the faulting instruction; the preceding store must occur once. The runner
requires the fault success marker. This proves architectural fault preservation;
diagnostic aggregate counts do not identify the tier of that individual fault.
Diagnostic artifacts additionally require observed inline/fallback execution in
hot runs and helper-only execution in cold runs. Uninstrumented fixture success
alone does not provide an exact inline execution count; reports say so.

For the diagnostic runtime, use the stricter runner:

```sh
node experiments/m2-sha-msg2/run-guest-exact.mjs \
  --runtime artifacts/m2-msg2-diagnostic-build-new/runtime/x86_64/qemu-system-x86_64.js \
  --fixture artifacts/m2-msg2-guest-01 --enabled on \
  --output artifacts/m2-msg2-diagnostic-on-new
node --test experiments/m2-sha-msg2/fixture-check-exact.test.mjs
```

Repeat with `--enabled off`, and optionally `--cold`, in fresh output paths.
This runner requires the diagnostic counter ABI and pins the precise built
guest source hash. For modes 0–5 it requires `original + inline == 4096`;
mode 6 requires exactly 8192 because it includes 4096 successful fault warmup
instructions. The final fault must contribute zero: the guest source load
precedes the helper/inline body, and the signal handler skips the instruction.
Compiled fallback is a subset of `original`, not an additional execution.
Extra executions, missing work, or counting the fault fail the gate. Each row
records exact interpreted, compiled-inline and compiled-fallback partitions.

The original runner and checker remain byte-identical for the completed
switch-runtime ISA reports. Their copies and hashes are retained under
`artifacts/m2-msg2-guest-runner-v1-archive-01`; the binary has eight static MSG2
sites, confirmed in `artifacts/m2-msg2-exact-count-audit-02`. Exact live counter
results remain a separate required diagnostic gate.

Follow these gates with unchanged Bun correctness, a held-out workload, the
declared uninstrumented screen, and fresh paired confirmation with resource and
regression budgets. Preserve the off control and all failures. Do not promote
the candidate from an emitted-code fixture or an instrumented timing result.

## Independent evidence review

After the JavaScript analyzer writes a screen or confirmation analysis, run:

```sh
python3 experiments/m2-sha-msg2/review-confirmation.py \
  --campaign artifacts/m2-confirmation-new \
  --analysis artifacts/m2-confirmation-analysis-new/analysis.json \
  --output artifacts/m2-confirmation-review-new
python3 experiments/m2-sha-msg2/review-confirmation-test.py
```

The Python reviewer uses only the standard library and never imports or executes
the JavaScript analyzer. It rehashes frozen inputs, Node/Chrome, packages,
snapshots, maps, raw reports and acceptance records; reconstructs raw serial and
COM1 protocol identities; checks fresh capture nonces and alternating pairs;
and recomputes paired medians, xorshift32 resampling, percentile intervals and
all measured gates. Confirmation also recursively reviews its separate screen.
It compares the recomputation to the published analysis and inventories every
attempt, including failures. A completed successful unaccepted observation is
rejected. A success exit means agreement and valid evidence; the recomputed
`confirmationPassed` may still be false. Product promotion remains false.

The retained review records its own SHA-256 and every verified input. It does
not establish unmeasured host peak memory, generated-code resources or ISA
correctness. Requiring current frozen inputs intentionally makes source drift
a failed review instead of silently analyzing with changed implementations.
Tests include raw protocol corruption, artifact tampering, independent fixed
bootstrap values, every regression gate, a complete screen, and all 16 fresh
confirmation captures with separate recursive selection evidence.
