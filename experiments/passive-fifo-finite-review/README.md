# Independent passive FIFO finite-horizon review

This Python reviewer audits the separately frozen `passive-fifo-finite-v1` campaign. It never starts a guest, build, timing plan, browser, or compiler VM. Exit zero means that retained evidence and the published analysis agree. Read `recomputed.selected` or `recomputed.confirmationPassed` separately; `productPromotionEligible` always remains false.

The reviewer independently reconstructs H from the browser's pre-start clock through the complete gate's stopped effective-policy read. All20 prelude and32 subsequent100-call batches remain. It reports all52 phase sums,13 batches for each workload, per-workload prelude/subsequent totals, startup prefix,51 gaps, and final suffix. The partition must close within1e-6ms. Ready time, the20-empty-gate nearest-rank95th percentile, and the maximum result-to-stop tail across all52 phases are recomputed without subtraction.

The independent hash-pinned validation reviewer supplies runtime-build/provenance and snapshot-envelope checks. Its separately pinned Python sustained protocol dependency supplies unchanged guest gates/oracles and primitive paired bootstrap/chi-square calculations. No JavaScript validator or analysis function is imported by the acceptance CLI. New finite-horizon arithmetic, fixed design, attempt classification, selection, five-secondary multiplicity, and pilot planning are implemented here. Synthetic fixtures execute the frozen JavaScript analyzer only to produce a cross-implementation test comparison.

Fresh off/on pairs are the only statistical units. The50000-draw xorshift32 bootstrap uses seed20261107, identical pair-index draws across endpoints, and the frozen floor quantile rule. Primary upper uses two-sided99%, five secondary guards use one-sided99.8%, readiness99%, and the two service guards99.5%. The pilot independently inverts the df3 chi-square CDF and Normal CDF, inflates the four-pair log SD by its90% bound, targets80% approximate Gaussian power, then rounds the largest endpoint count even with minimum8 and cap32 without clamping. These are family-specific nominal bounds and approximate planning, not a joint guarantee or a bootstrap power proof. Drift is reported descriptively and never censors a run or vetoes the campaign.

Every attempt directory requires a pre-spawn request and proven child exit. Accepted attempts require exact report/request/start-marker hashes, chronology, fresh UUIDs/nonces, raw serial/maps, all148 gates/149 signals, final eligible policy state, stopped compiler checks, frozen execution/served inputs, and inner/compressed/outer snapshot hashes. Any orphan, unknown-start, post-start failure, omitted completed run, or permanent halt marker rejects the whole campaign. Only a hashed failed pre-start certificate with no start marker and no browser result is retainable. Confirmation recursively replays the independent pilot, its exact count, unchanged design/packages, and disjoint captures.

Before a timing plan exists, three real independent prerequisite reviews must pass: held-out capture/restore, combined diagnostic correctness/lifetime, and matched generated-input-byte resources. The ledger helper verifies their inventories and binds them to the actual reviewed performance runtime and unchanged policy overlay. It requires actual on-arm soft retirement/natural-GC exposure and control emergency retirement from the combined review. Its diagnostic scope remains256MiB translation storage and bounded observed Asyncify evidence; it does not prove arbitrary suspended-instance eviction or general fiber lifetime safety.

After those reports exist, record only their prerequisite identities:

```sh
python3 -B experiments/passive-fifo-finite-review/prerequisites.py \
  --control artifacts/passive-fifo-package-off-01 \
  --candidate artifacts/passive-fifo-package-on-01 \
  --heldout artifacts/passive-fifo-heldout-review-01/review.json \
  --diagnostic artifacts/passive-fifo-combined-review-01/review.json \
  --resource artifacts/passive-fifo-resource-review-01/review.json \
  --output artifacts/passive-fifo-finite-prerequisites-01.json
```

The package paths above name the current reviewed finite packages. The helper creates no timing plan. Freeze this ledger, all three referenced review files, the actual runtime build/overlay/post-build audit, and the finite/overlay source reviews in the future plan's `inputs`. Those prerequisites must predate that plan. All their referenced evidence is rehashed during independent review.

Once root has run and analyzed a fresh campaign:

```sh
python3 -B experiments/passive-fifo-finite-review/review.py \
  --campaign artifacts/PASSIVE-FINITE-CAMPAIGN \
  --analysis artifacts/PASSIVE-FINITE-ANALYSIS/analysis.json \
  --prerequisites artifacts/passive-fifo-finite-prerequisites-01.json \
  --output artifacts/PASSIVE-FINITE-INDEPENDENT-REVIEW
```

Use a fresh output directory. The reviewer rehashes its inventory before publishing and fsyncs `review.json`, its output directory and every ancestor through the project root. The acceptance CLI rejects project `tmp` and synthetic reports. A failed review also retains its failure and observed identity inventory.

Host-only tests:

```sh
python3 -B experiments/passive-fifo-finite-review/test-review.py
```

They create explicitly synthetic fixtures in project `tmp`; no fixture result is live policy evidence. They cover complete four-pair pilot plus fresh confirmation, cost-boundary corruption, raw protocol/maps/snapshot corruption, each secondary guard, drift non-censorship, planning/multiplicity, typed identities, fractional timestamps with integral elapsed JSON values, unknown/post-start attempt rejection, certified pre-start retention, and durable output. Historical MSG2 measurements are neither reused nor relabeled.

Runtime file bytes, observed linear memory and cumulative generated input bytes have separate scopes. None measures native resident JIT bytes, true host peak memory, worst-case guest service latency, or long-run stability. Statistical passage alone does not close these product-promotion gates.
