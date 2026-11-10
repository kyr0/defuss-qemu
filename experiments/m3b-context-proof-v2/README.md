# Context census build provenance

This isolated tool composes the reviewed M3b budget-one implementation with the
new default-off context census and generation-specific recovery diagnostic. It
uses the exact reviewed v2 path, link, hashing and SDK readers without editing
them. It does not change the original runtime, source archives or failed runs.

`freeze` archives the four new source roots alongside the original 57 archived
source rows and closes local JavaScript imports. Actual retained host-test
records are required. An independent review of that exact manifest is required
for `compose`, `recheck` and `bind`.

`compose` checks the deterministic native generator against the frozen M3b base,
then flattens both overlays relative to the original M3a base. Full source trees
and exactly the 14 inherited internal links are checked. Both overlay stages,
the actual composition tool and the new diagnostic variant remain explicit.

`recheck` repeats all source checks after the actual build and verifies the
pinned offline SDK invocation, four-job command (or the explicit selected job
count), successful configure/compile steps and all seven runtime companions.
`bind` runs the actual existing Node identity consumer before durable publication.
The context runner must additionally require the variant and native census ABI.
No command synthesizes source-review, guest, timing or performance acceptance.

Run through `python3 -B scripts/with-tmp.py -- ...`; all staging stays in project
`tmp`. Every artifact directory must be fresh. Failed outputs remain retained.

## ABI2 correction

The first actual OFF census capture stopped at gate5 because raw CS/SS cache
flags used two representations of the same decoded segment limit. The prior
ABI1 sources, runtime and failed capture remain immutable. This new variant
binds architectural segment flags and separately retains raw flag encodings.
It does not forgive a sticky ABI1 fault or reuse the failed capture as a pass.

The entire reviewed ABI1 source/dependency closure is rechecked as historical
provenance. The new native overlay is still generated from frozen original M3b
source01, so a fresh full build and runtime proof are required.
