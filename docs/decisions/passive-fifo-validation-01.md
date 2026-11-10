# Passive FIFO validation before the finite-horizon pilot

The isolated default-off policy has passed its scoped correctness and
cumulative generated-input-byte gates. No timing result or production
promotion is established by this record.

Both diagnostic and performance runtimes were built with the pinned SDK.
Post-build audits checked all 10,103 source files against the 10,099-file
baseline, exactly seven reviewed changes and all runtime artifacts. Their
source trees differ only in the diagnostic compile-time flag. The policy
constants, hard 12,000-instance cap, fallback and pending-GC accounting remain
as specified before these runs.

Four fresh held-out capture/restore runs passed 1,536 digest checks in total,
including read-only snapshot restoration, original payload oracles and exact
source/runtime/snapshot hashes. The enabled performance runtime reported
locked choice, actual eligible execution and zero rejection bits. Off reported
the locked legacy choice and no new-policy activity.

The first combined diagnostic attempt never reached a guest gate. Its wrapper
supplied a shared observer buffer after worker loading. That source, derived
JavaScript, header-only progress and controlled-abort failure remain preserved;
the literal missing-buffer exception was not captured. Revision02 supplies the
buffer before factory startup and publishes the native address through shared
storage. It adds a regression test using the generated callback order, durable
error records and a bounded startup deadline. The native runtimes and guest
image were unchanged.

The corrected combined image runs the original pressure and main binaries in
one VM. Independent image review verified both ELF bytes and 283 shared base
archive entries. Both corrected runs passed the exact architectural oracle:
414,178 checks each, 384 precise faults, alias/active self-modification,
interrupts and blocked-read continuation. Independent replay checked 134
identities and the complete raw protocols and observer traces.

| Observation | Off | On |
| --- | ---: | ---: |
| Stopped gates | 131 | 127 |
| Generated pressure nodes | 6,912 | 6,848 |
| Soft retirement batches | 0 | 2 |
| Soft-retired instances | 0 | 512 |
| Emergency-retired instances | 6,000 | 0 |
| Naturally delivered callbacks consumed | 6,000 | 256 |
| Pending retirement at completion | 0 | 256 |
| Post-warm global translation-buffer flushes | 0 | 0 |

Both traces include a complete observed unwind/rewind episode after retirement,
beginning while running and closing at a stopped snapshot. Accounting and
Normal-state checks passed. Neither main segment had additional retirement or
GC consumption: these are correctness checks after actual retirement, not proof
of retirement during each fault or self-modification operation. Aggregate
compiled-call counts do not establish individual-function exposure or eviction
of a particular suspended instance. The diagnostic translation buffer is
256 MiB; separate application/held-out runs retain the production 128 MiB size.

A separately frozen matched resource pair used the exact performance WASM and
the reviewed module-input observer. All 52 workload batches passed in each
capture. Analysis and independent replay found an enabled/off cumulative
successfully instantiated module-input-byte ratio of **0.7314775974896528**,
within the 1.10 budget. Reinstantiations are charged again. This is one resource
pair, not a timing result, live/native JIT resident memory, true host peak or
long-run resource bound.

The next gate is the prospective finite-horizon pilot: four wholly fresh
alternating pairs, startup and all 52 batches included, unchanged statistical
budgets and no replacement of a post-start/unknown-start observation. Fresh
confirmation is permitted only if selection and the predeclared sample-size
planning rule pass. Missing product resource/compatibility gates remain open.

Evidence:

- [Held-out independent review](../../artifacts/passive-fifo-heldout-review-01/review.json).
- [Combined independent review](../../artifacts/passive-fifo-combined-review-01/review.json)
  and [preserved first-attempt failure](../../artifacts/passive-fifo-combined-off-failure-review-01/review.json).
- [Resource independent review](../../artifacts/passive-fifo-resource-review-01/review.json).
- [Prospective measurement design](passive-fifo-finite-horizon-design-01.md).
