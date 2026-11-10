# Defuss-vae integration, 2026-11-08

The repository includes defuss-vae 0.9.0 under `.agents/`, copied without
source changes from commit `dc0f6b5ea4973b2f3224a589d38c19386126e09d`.
The file inventory in `.vae/installation.json` identifies the installed bytes.
Local copies make the skill-relative CLI paths work without another checkout.

The project previously had copied skills but no CLI or Git repository.
Local Git metadata now supports session change detection. No commit was made.
The current Codex session loaded the installed SessionStart adapter, which
preserves its baseline when called again. The agent invokes the gate explicitly:

```sh
make gate VAE_SESSION="$CODEX_SESSION_ID"
```

Automatic Codex hook attachment remains unverified. Explicit session invocation
and the repository instructions govern this chat; they do not prove that the
Codex application will invoke every hook automatically in another session.

`make verify` runs syntax and installation checks, the retained package tests,
the new VAE integration tests, coverage, artifact consumption, and the retained
QEMU/runtime identity checks. The project keeps its existing Node, Python and
pinned SDK toolchain. It does not migrate package managers during onboarding.

The new tests exercise real files, Git and subprocesses. They verify that
initialization preserves an existing Makefile, damaged installations fail,
and an unverified edit causes commit denial both before and after session
resume. The artifact check tests an extracted zip in a clean consumer. Its
tests use that consumer's installed CLI and hooks.

Coverage measures the new installation verifier. It does not measure QEMU,
the full VM or the vendored VAE implementation. The initial measured result
was 91.4%. Existing package unit tests alone measured 53.42% of their imported
JavaScript modules; that separate figure is not replaced by the onboarding
coverage figure. Full VM acceptance remains a separate requirement.

`make start`, `stop`, `status` and `log` use VAE's owned process registry for
the local preview server. `make bench` reads retained reports; it does not
silently launch or extend a timing campaign. Fresh performance work keeps
its frozen protocol, separate diagnostic captures and exact runtime identities.
