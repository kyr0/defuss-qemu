# Independent MSG1 Bun exposure replay

This Python reviewer uses only the standard library and hash-pinned independent
M1 protocol/manifest primitives. It never runs the JavaScript analyzer or a VM.
MSG1 mode/ABI, runtime/source/ISA proof, whole counter partition, raw serial,
durable pre-ACK rows and served-file requirements are replayed separately.
The snapshot envelope is streamed, including compressed and raw SHA-256 checks.

The source manifest and independent source review are pinned. Every input is
rehashed before a passing publication. Output directories are fresh; success
or failure reports and their parent directories are fsynced. No prior evidence
is overwritten. A failed review is not a failed optimization.

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m2-msg1-exposure-review/test-review.py
python3 -B scripts/with-tmp.py -- python3 -B experiments/m2-msg1-exposure-review/review.py \
  --control artifacts/m2-msg1-exposure-off-01/report.json \
  --candidate artifacts/m2-msg1-exposure-on-01/report.json \
  --analysis artifacts/m2-msg1-exposure-analysis-01/analysis.json \
  --expected-timeout-ms 1800000 \
  --output artifacts/m2-msg1-exposure-review-01
```

Tests use only small synthetic evidence and project-local `tmp`. They cover
both selected modes, complete 69-gate protocol replay, uint64 values above the
JavaScript safe-integer range, forbidden paths, reset/wrap, missing/raw/header
corruption, boolean substitutions, duplicate JSON keys and snapshot corruption.
No production evidence may use the synthetic helper as an identity substitute.

All reported counters include their stopped interval's control and delivery
work. Positive JSON/HTTP/integer and boot/gap/tail counts remain visible. This
is diagnostic exposure, with no speed ratios, CPU-time attribution, performance
acceptance or promotion. A 30-minute diagnostic deadline is bound explicitly;
it does not change the separate frozen timing experiments.

JSON parsing follows Python's documented `object_pairs_hook` and
`parse_constant` controls to reject duplicate keys and nonfinite constants.
JSON booleans are checked separately from numeric clocks.
