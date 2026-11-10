# Independent boundary evidence replay

`review.py` independently replays the two retained `m3b-boundary-{off,on}-01` captures in Python. It does not import the JavaScript contract/replay validators, compile code, launch a browser or rerun a guest.

The raw replay reconstructs the deterministic guest oracle, all 11 COM1 gates, all 38 native profile control records, every stopped raw bank/watch epoch, and the four ON compiled-fused intermediate-state probes. The full mode additionally rehashes actual report inputs, original source freezes and archives, changed prepared sources, runtime/image bytes, exact compiler and SDK completion records, graph literals, mandatory served modules, and the recorded Chrome/Lima executables. The full 10111-file engine inventory is bound to the already completed, independently reviewed proof-v2 audit; this reviewer does not recompute that tree fingerprint or rerun its tool.

Fresh outputs only, root-serialized:

```sh
python3 scripts/with-tmp.py -- python3 experiments/m3b-boundary-review/test-review.py
python3 experiments/m3b-boundary-review/review.py --inspect --output artifacts/m3b-boundary-raw-review-02
python3 experiments/m3b-boundary-review/review.py --full --output artifacts/m3b-boundary-review-01
```

`--inspect` defers files over 1 MiB and cannot report `passed`. `--full` is appropriate only in an approved heavy-work gap; it reads runtime/rootfs identities. Source and evidence must remain quiet throughout. Each read checks its stat identity before/after and all identities are checked again for source drift before fsynced publication. Failed outputs are retained; rerun in a fresh directory.

A passed boundary review is narrowly scoped. Asyncify Normal at the observed return is not a suspension/resumption test. The private forced B request is not a natural interrupt. Legacy FP/SSE preservation does not establish full XSAVE/YMM preservation. The separate 45-gate ON capture failed and remains an explicit blocker to broad M3b acceptance. No performance conclusion or promotion follows. The obsolete static `openGates` draft string saying these captures are unexecuted is superseded in the review, with the original reports left intact.

The focused tests use retained small reports as semantic fixtures, deliberately substitute wrong QMP errors, extra gates, boolean words, register/service/generation changes, high-half lazy-flags truncation, and altered SDK command arguments. Semantic test inputs intentionally bypass file hashing; actual `--full` is the separate identity test.
