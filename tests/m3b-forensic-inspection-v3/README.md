# Offline forensic inspection revision3

This isolated offline tool preserves every byte of the frozen forensic-v2 sources and failed capture. It changes only interpretation of the capture's two argv metadata forms. The pre-run durable header must equal the exact intended CLI; the final report must equal that CLI with exactly one `./this.program` prepended. The exact retained191,691-byte runtime JavaScript SHA256 is mandatory, and both its default thisProgram assignment and callMain/unshift anchor must occur exactly once. A different CLI, missing/duplicate argv0, or different runtime is rejected. No source or report is normalized in place.

`inspect.mjs` is derived from the frozen v2 inspector. Apart from imports into that unchanged directory, its only functional deltas are the argv proof above, hashing the two new tool sources, and retaining that proof plus the original runner failure in a distinct diagnostic result. Queue, chunk, closure, raw protocol, RF parser, per-gate windows and original guest oracle interpretation are unchanged. The v2 parser remains imported byte-for-byte. Neither this tool nor its synthetic tests provide baseline acceptance. Both the native gate3 failure and runner metadata assertion remain failures in the result.

Source is drafted, not yet syntax-checked/tested or independently source-reviewed at authoring. Root owns checks and execution after review. There are no VM actions in this tool.

```sh
python3 -B scripts/with-tmp.py -- node --test tests/m3b-forensic-inspection-v3/test-argv.mjs
python3 -B scripts/with-tmp.py -- node --check tests/m3b-forensic-inspection-v3/inspect.mjs
python3 -B scripts/with-tmp.py -- node tests/m3b-forensic-inspection-v3/inspect.mjs --run artifacts/m3b-forensic-v2-on-01 --output artifacts/m3b-forensic-v3-inspection-01
```

The inspector still does not independently replay every native bank or the full runtime/SDK build proof; the separate capture reviewer supplies that evidence. RF certificates establish an exact A prelude exit, not B retirement or a complete logical partition. Non-recurrence cannot replace the retained original ON01 failure.
