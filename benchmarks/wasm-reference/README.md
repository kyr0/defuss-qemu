# M1 standalone WASM computational references

This suite implements the original dependent integer recurrence and generic
SHA256 compression/complete hashing as synchronous WASM components. It is an
optimistic computational reference for PLAN.md §7.4 and the first standalone
step of §10.4. It does **not** recognize Bun routines, replace guest instructions,
implement guest page faults, or establish an integrated accelerator.

The module is **wasm32, unshared, fixed 16 MiB memory**, with an 8 MiB owned
scratch arena. The current full-system VM uses **memory64/shared memory**.
A ratio between their timings includes memory-model, execution-profile and
interface differences; it does not isolate VM-only overhead or establish a
hardware lower bound. Strict SIMD is enabled for compilation; the SHA algorithm
uses generic unsigned integer semantics, without relaxed numerical operations.

## Build and run

Run heavy SDK builds and all guest/reference measurements serially. Use the
project's configured Docker/Lima adapter and pinned SDK:

```sh
python3 scripts/sdk.py python3 benchmarks/wasm-reference/build.py \
  --output artifacts/m1-reference-build-new
node benchmarks/wasm-reference/check.mjs \
  artifacts/m1-reference-build-new m1-reference-check-new
REFERENCE_SAMPLES=7 REFERENCE_WARMUP=5 REFERENCE_CALLS=10 \
  node benchmarks/wasm-reference/run.mjs \
  artifacts/m1-reference-build-new m1-reference-node-new
```

The build refuses an existing output directory. Node runners refuse an existing
`artifacts/wasm-reference/<label>/` directory, verify the WASM/build/source
identities, and emit `report.json`, including failures. `--dry-run` on the build
script prints the exact command without compiling. Build records contain SDK
digest, emcc version, flags, source/build-script hashes, elapsed time and final
WASM hash/size. No package download or external C library is required.

The browser-compatible modules expose:

```js
import {createReference} from './reference.mjs';
import {validateReference} from './validate.mjs';
import {runBenchmarks} from './benchmark.mjs';
const api = await createReference(await (await fetch('/path/references.wasm')).arrayBuffer());
const validation = await validateReference(api);
const benchmark = await runBenchmarks(api, {samples: 7, warmup: 5, callsPerSample: 10});
```

A browser runner should record the fetched WASM/build/module identities and the
exact browser version with its results. `createReference` separately measures
compilation and instantiation and requires a module with **no host imports**.
`validateReference` uses an independent BigInt compression oracle and, where
available, WebCrypto for complete-hash validation **outside timed intervals**.
It never substitutes asynchronous WebCrypto for the synchronous kernel. The
Node wrapper instead supplies `node:crypto` as its complete-hash oracle.

## Operation and memory contract

The raw exports are a **prevalidated internal ABI**. Raw pointer calls assume
in-bounds, properly aligned, non-overlapping inputs. They can trap or violate
those preconditions if called directly with invalid pointers. Application-facing
experiments should use the checked JS API. Neither layer accepts guest virtual
addresses: these are offsets into this instance's owned linear-memory arena.

| Interface | Semantics and limits |
| --- | --- |
| `raw.ref_integer(seed, count, multiplier, increment)` | Exact u32 recurrence `(x ^ i) * multiplier + increment`, wrapping modulo 2³². The JS result is signed i32 until coerced with `>>> 0`. |
| `integerChecked(...)` | All arguments must be u32; at most 1,000,000 dependent iterations per call. |
| `raw.ref_sha256_compress(state, bytes, blocks)` | Arbitrary eight-word chaining state; complete 64-byte blocks; no padding or message identity; modifies only state. State words are WASM little-endian u32, message words are SHA big-endian. Input byte alignment is unrestricted; state alignment is four bytes. |
| `compressResident(state, bytes, blocks, {maxBlocks})` | Validates the **whole requested** input range and disjoint state before changing anything. Processes up to `maxBlocks`, default/max 1,024, and returns exact completed/remaining block counts. |
| `compressCopied(state, bytes)` | Copies an external eight-word `Uint32Array` and up to 1,024 complete blocks into the arena, runs the checked operation, returns an owned state copy. Zero blocks preserve state. |
| `hashResident(bytes, length, digest)` | Synchronous SHA256 initialization, all input, padding and finalization; disjoint output, at most 1 MiB per call. Digest is 32 bytes in standard order. |
| `hashCopied(bytes)` | Guarded staging, synchronous complete hash, independent returned 32-byte copy. |
| `initContext`, `updateContext`, `finalContext` | Aligned eight-byte context, arbitrary update partitions (including empty updates), at most 1 MiB per update; output/input may not overlap context. Finalization can occur once. |

All checked range arithmetic uses safe integer subtraction before calling raw
WASM; negative/fractional/overflowing values are rejected. Zero-length input at
the arena end is permitted. Every nonempty state/input, digest/input, or context
alias is rejected; no partially overlapping case is silently accepted. Invalid
checks happen before any mutation. Context errors (already finalized, malformed
buffer count, or total bit-length overflow) also return before mutation.

Compression cancellation is explicit: issue one bounded call, inspect progress,
and decline or defer the next call. Completed blocks stay committed exactly
once; resume with the updated state and advanced input offset. There is no
hidden job, asynchronous continuation or callback. A caller yielding between
chunks must retain ownership of the instance and revalidate its own input
lifetime. Chunk budgets bound work but are not a measured responsiveness SLA.
Full hashing is bounded by its input cap and is not cancellable midway.

Copied APIs reject shared, resizable and detached buffers, as well as views of
the scratch memory itself (use the resident API for those). Returned copies do
not alias source or scratch bytes. Memory growth is disabled; changing even the
buffer identity with `memory.grow(0)` invalidates checked resident operations.
The raw exports and exported memory are deliberately inspectable; this wrapper
is a contract checker for owned experiments, not an isolation/security boundary.

Streaming total length is tracked as u64 and rejects byte counts beyond
`2^61 - 1`, so the SHA bit-length field never wraps. Context offset-query exports
exist for explicit ABI validation. The suite uses synthetic states to test high
length-bit encoding without claiming to have hashed exabytes of input.

## Validation coverage

`validate.mjs` checks:

- Original integer parameters (seed 123, 250,000 iterations, multiplier
  1,664,525, increment 1,013,904,223) and 200 deterministic arbitrary cases
  against BigInt modular arithmetic.
- Compression from arbitrary chaining states with zero/one/multiple blocks,
  offsets around byte/SIMD/page boundaries, unchanged input, and copied results.
- Bounded compression progress, cancellation by withholding subsequent calls,
  and exact continuation from the committed state.
- Empty/`abc` known digests, original 65,536-byte pattern, randomized messages,
  and padding boundaries including 55/56/63/64/65 bytes.
- Every update partition for lengths 0–9, bytewise boundary messages, and
  deterministic boundary/randomized partitions of longer inputs.
- Rejection without memory mutation for misalignment, overflowing ranges,
  unsupported aliases/service budgets, malformed/finalized contexts and length
  overflow; copied-buffer ownership and unsupported buffer kinds.
- Synthetic high-length finalization at 2³² and the SHA byte-length limit.

The original benchmark source is unchanged. Node wrappers additionally compare
the named original integer/hash outputs against `benchmarks/expected.json`.
Fixtures are deterministic but use arbitrary state/data and do not rely on a
recognized workload hash to return answers.

## Timing interpretation

The named integer and complete-hash cases preserve the original arithmetic,
65,536-byte pattern `(i*17+23)&255`, and sixteen hashes per SHA job. Complete
hashing returns digest bytes; Bun additionally creates crypto objects and hex
strings. Compression is a separate primitive reference with IV reset per call,
**without padding/finalization**. It is not presented as the same operation as
complete SHA hashing.

Each raw/checked/copied endpoint has a separate interval and raw observation.
Raw timing includes the unavoidable JS→WASM call, result observation and small
compression state reset. Resident inputs are staged before timing. Checked
resident timing adds guards. Copy timing includes source validation, 64 KiB
staging and result allocation/copy. Empty-call and copy-only diagnostics remain
visible and are **not subtracted** from another endpoint.

Results are consumed during the loop; expensive oracle comparisons happen
outside timed intervals, before the campaign and after each batch. Endpoints
rotate order between samples. Fixed warmup, host engine/version, code size,
compile/instantiate costs, timestamps and the full observation list are retained.
Batches in one module/process are nested observations, not independent launches;
min/median/max summaries do not supply a statistical performance claim. An
integrated guest measurement and frozen independent confirmation are later gates.

## Browser runner

Run the same validation and reference intervals in a fresh installed Chrome
process with an owned loopback server. No browser or dependency is downloaded.
Set `DEFUSS_VM_CHROME` to use a specific Chrome executable; otherwise the
project's installed Playwright Chromium is used, matching the M1 VM runner.
Run this serially after SDK builds and other VM/reference measurements finish:

```sh
DEFUSS_VM_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node benchmarks/wasm-reference/browser-run.mjs \
  artifacts/m1-reference-build-new m1-reference-chrome-new
```

Defaults are seven samples, five warmup jobs per endpoint and ten calls per
sample. `--samples`, `--warmup`, `--calls` override `REFERENCE_SAMPLES`,
`REFERENCE_WARMUP`, `REFERENCE_CALLS`; `--timeout` or `REFERENCE_TIMEOUT`
sets the host watchdog in milliseconds (default 300000).

The runner reserves a fresh `artifacts/wasm-reference/<label>/` directory,
verifies the build report, WASM bytes, kernel/build-script identities and
canonical integer/SHA answers, and pins all current module/source hashes.
The server serves immutable in-memory bytes from a fixed route list; Chrome
also verifies every fetched module and the WASM SHA256 before execution.
Source files are checked again at completion. Failure reports retain whatever
validation/runtime evidence was available; browser and server are closed on
success, error or watchdog expiry.

`report.json` includes exact browser/CDP/V8 version, host versions/load,
compile/instantiate measurements, validation case counts, raw interval
observations, observed checksum, all input/fetched hashes and module size.
WebCrypto is required solely as the independent complete-hash oracle outside
measurement. Timed hashing remains the synchronous, import-free WASM kernel.
The same wasm32/unshared versus VM memory64/shared distinction and component
timing limits described above apply to Chrome results.
