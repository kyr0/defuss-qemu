# Independent typed-recovery replay

This new Python reviewer checks both actual OFF control and ON typed-recovery captures against the unchanged ABI2 runtime. Source and synthetic tests are prepared; they must pass root-serialized validation and independent source review before the source freeze or actual replay. No result is implied by this document.

`baseline.py`, `semantics.py` and `trace.py` are unchanged copies of the frozen independent baseline reviewer at `artifacts/m3b-context-v3-review-source-02`. New `recovery.py` validates the original raw stage counters before making a narrowly checked structural-decoder view, then restores every actual counter and raw census array. It admits only action1 after gate1 and action2 after gate5, each one actual paused native call with exact before/after bank changes. The original raw inputs remain unchanged.

The independent trace calculation proves the exact old-owner gate6 refusal (including rejecting extra orphaned stops), fresh owner generation and context, actual compiled/TCI tier counts, all RF attempts, and the fixed body/service equations. TCI is never relabeled compiled. Global pre-admission guard redispatches remain explicit without owner attribution or extra body/service terms. The outer driver independently enforces all45 guest digests, complete request/injection/reset/ACK ordering, chunk hashes, terminal suffix, baseline/runtime/source identities and serial owned-process cleanup.

Synthetic tests use only small constructed inputs; no historical trace, runtime, browser or SDK is read/executed. The test imports the seven local source files and Python standard library only:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-context-recovery-review/test_review.py
```

After the actual host tests and frozen source review pass, and both capture browsers have closed with successful same-code offline inspections:

```sh
python3 -B scripts/with-tmp.py -- python3 -B experiments/m3b-context-recovery-review/review.py \
  --off artifacts/m3b-context-recovery-v2-off-01 \
  --on artifacts/m3b-context-recovery-v2-on-01 \
  --off-inspection artifacts/m3b-context-recovery-v2-inspection-off-01 \
  --on-inspection artifacts/m3b-context-recovery-v2-inspection-on-01 \
  --off-execution artifacts/m3b-context-recovery-v2-execution-off-01 \
  --on-execution artifacts/m3b-context-recovery-v2-execution-on-01 \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --output artifacts/m3b-context-recovery-v2-review-01
```

The driver pins actual recovery source02/review02 and the accepted baseline. Only a complete successful replay may set `typedRecoveryPassed:true`; `candidatePromotion:false` remains explicit. Fresh owner compilation is claimed only if its real compiled-tier counter is positive. Typed paused metadata injection does not prove natural SMC, pressure/GC recovery, suspended stacks, full XSAVE, timing or production eligibility.

All scratch belongs under project `tmp`. Output directories are exclusive, files and directories are fsynced, and failed attempts are preserved. Existing frozen reviewer sources and capture files are unchanged.
