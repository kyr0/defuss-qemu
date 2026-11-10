# Independent ABI2 baseline replay, scoped global guard revision

This fresh five-file Python reviewer preserves the frozen v2 reviewer and the failed v4 ON capture. It targets a future reviewed host-v5 source and fresh OFF/ON captures with the unchanged ABI2 runtime. No actual baseline is claimed by these sources.

The exact native `goto_tb` and `goto_ptr` guard sites count ordinary TCI routing returns before target admission. This revision retains their raw nonnegative monotonic `tciTargetReturns` delta as `globalGuardRedispatches`, with no watched-owner attribution and no body or service term. All selected fused-TCI, watched-backedge, native census/context/owner, RF certificate, guest, service and full capture requirements remain unchanged. Actual source anchors are bound to the postbuild prepared-source inventory and the reviewed host freeze.

`semantics.py` is byte-identical to the frozen previous reviewer. `trace.py` changes only the global guard rule/report and adds an exact monotonic counter helper. The driver binds host-v5 and accounting-v3 identities and compares the separate global report. Prior failed runs cannot pass the fresh complete-run protocol.

Synthetic validation (root serializes execution):

```sh
python3 scripts/with-tmp.py -- python3 experiments/m3b-context-v3-review/test_review.py
```

Actual replay only after both fresh captures and root offline inspectors pass, with source hashes pinned before use:

```sh
python3 scripts/with-tmp.py -- python3 experiments/m3b-context-v3-review/review.py \
  --off artifacts/m3b-context-v5-off-01 --on artifacts/m3b-context-v5-on-01 \
  --off-inspection artifacts/m3b-context-v5-inspection-off-01 \
  --on-inspection artifacts/m3b-context-v5-inspection-on-01 \
  --off-execution artifacts/m3b-context-v5-execution-off-01 \
  --on-execution artifacts/m3b-context-v5-execution-on-01 \
  --binding artifacts/m3b-context-v2-binding-01/binding.json \
  --output artifacts/m3b-context-v2-baseline-review-01
```

Only an actual complete replay can set `baselinePassed:true`; `candidatePromotion:false` remains explicit. No timing, natural interrupt, pressure/GC recovery, full XSAVE or production eligibility claim. Failed audit attempts are retained, and outputs are exclusive/fsynced.
