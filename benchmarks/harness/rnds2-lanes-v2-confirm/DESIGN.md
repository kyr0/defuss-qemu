# Independent confirmation of the selected RNDS2 lane v2 candidate

The completed four-block screen found SHA time ratios 0.9624 versus retained
RNDS2 and 0.9648 versus its matched rebuild. Both marginal 95% intervals
crossed one. That is inconclusive, not an accepted speedup. The small apparent
benefit motivates this bounded independent confirmation. Never pool the two
sets or keep adding captures until an interval crosses a threshold.

Use exactly six new blocks, each with one independent cold launch of all three
arms. Run all six permutations, fixed in the machine-readable plan before
capture; every arm occupies every position twice. Reuse the exact frozen
measurement runner, runtimes and unchanged M1 guest package. The runner's
report references its original protocol plan; the new outer plan binds that
protocol and the confirmation controller, order and analysis separately.
No diagnostic flags/counters, snapshots, build overlap or user-process changes.
Keep the 30-minute capture and 35-minute outer deadlines. Retain every attempt.

The independent unit is the three-arm block. Aggregate each launch's three
100-call same-workload batches by median. Compute paired candidate/original,
candidate/control and control/original ratios. Use log-Student-t marginal 95%
intervals with six units, df=5, critical value 2.570581835636314. SHA is primary.
Require its upper interval bound below one against BOTH references to report
a scoped improvement. The planning target remains at least 5% lower time;
only upper bounds below 0.95 establish that magnitude. Do not switch to a
secondary endpoint if SHA fails. Secondary intervals are descriptive, with no
simultaneous/family-wise coverage claim. Six blocks may still be inconclusive.

Prospective promotion budgets: at most 5% time regression for readiness,
full horizon and other workloads; at most 1% runtime Wasm byte growth; unchanged
2 GiB linear memory and hard 12,000-instance cap. Peak process memory and
guest service/interrupt latency are not established by these captures; their
5% regression budgets remain untested gates, not assumed passes. Result-to-stop
delay is an interface diagnostic, not guest interrupt latency. Held-out
application and platform acceptance also remain separate. This campaign does
not automatically promote a runtime or update historical native-gap ratios.

Reconstruct every raw serial byte and elapsed interval; replay the existing JS
lifecycle oracle; verify all input hashes and cleanup; reject nonce reuse from
the exploration. Freeze this design and both controllers before starting.
