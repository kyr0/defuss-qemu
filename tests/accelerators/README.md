# Held-out SHA integration cases

`msg2-heldout.mjs` runs the pinned guest Bun crypto implementation over 192 new
payloads: eight deterministic seeds for each of 24 lengths, covering empty
input, SHA padding boundaries, short and long buffers, unaligned slices and
one MiB inputs. Each payload is hashed both directly and through varying stream
partitions. The guest verifies the entire source allocation and guard bytes
remain unchanged. `run-msg2-heldout.mjs` independently reconstructs every
payload and verifies all 384 digests with host Node crypto.

Package the plain MJS file with `packaging/bun_app_package.py:package_app`,
`manual_ready=True` and the selected M2 runtime. Use the M2 `package.mjs` tool to
bind off/on selection to separate compatibility hashes. The runner requires the
packaged app hash to equal this exact fixture source, and the runtime must lock
the requested mode. Run one owned VM at a time:

```sh
node tests/accelerators/run-msg2-heldout.mjs artifacts/PACKAGE artifacts/CAPTURE
node tests/accelerators/run-msg2-heldout.mjs artifacts/PACKAGE artifacts/RESTORE artifacts/CAPTURE
```

Every output directory must be fresh. The optional third argument restores the
retained successful capture in a fresh Node process; its snapshot store is read
only, and any cold fallback fails the test. Repeat both runs for off and on
packages. Reports retain console output, snapshot protocol events, exact
package identities, source hashes, runtime selection and all digest results.

These cases validate integrated crypto and continuation correctness. They do
not measure speed or independently prove MSG2 compiled-path exposure; use the
separate diagnostic ISA fixture for that evidence.
