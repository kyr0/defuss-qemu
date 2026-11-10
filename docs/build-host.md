# Local compiler host recovery

The November 7 recovery replaced the vanished `/tmp/qw-lima` instance with a
persistent, task-owned Lima instance. The source import and retained runtimes
were not changed by this recovery.

The local instance is `builder`, under `/Users/admin/.defuss-vm-lima`. It uses
Lima 2.2.1, VZ, eight ARM64 CPUs, 12 GiB RAM and an 80 GiB disk. Its retained
creation configuration is [`artifacts/build-host/builder.yaml`](../artifacts/build-host/builder.yaml).
The Ubuntu 26.04 ARM64 cloud image has SHA256
`63a93bd5a8d76e33b15ceb5daa3657bd79be804748051ab178e643b0f5da22e7`.
Ubuntu's Docker 29.1.3 runs the pinned amd64 SDK container. The first recovered
M2 switch and diagnostic builds used qemu-user-binfmt. The original saved
builder configuration enabled Rosetta; that setting was restored after both
builds completed. The installed configuration is retained in
[`builder-installed-rosetta.yaml`](../artifacts/build-host/builder-installed-rosetta.yaml),
alongside its predecessor and change plan. This uses Lima's documented
[Rosetta configuration](https://lima-vm.io/docs/config/multi-arch/).
The SDK digest and Emscripten version remain the build contract; changing the
host still requires new paired measurements rather than importing old timings.

From this machine's `defuss-vm` directory:

```sh
export LIMA_HOME=/Users/admin/.defuss-vm-lima
export DEFUSS_VM_DOCKER_COMMAND='["/Users/admin/Documents/deepseek-harness/default-workspace/native-build/lima/bin/limactl","shell","builder","--","sudo","docker"]'
python3 -B scripts/with-tmp.py -- python3 -B scripts/sdk.py python3 scripts/build.py \
  --source artifacts/EXPERIMENT/source --output artifacts/BUILD \
  --targets x86_64-softmmu --jobs 8
```

The SDK image is
`registry.gitlab.com/qemu-project/qemu/qemu/emsdk-wasm64-cross@sha256:c7e05b4d0052cbc9e069add4ca01d80bab034c5d07ea1415e0522fcac6497812`.
Emscripten reports 5.0.2; the real
[post-restart SDK check](../artifacts/build-host/sdk-project-tmp-validation.json)
verified that version and actual scratch creation under `/project/tmp/sdk-*`.
`scripts/sdk.py` disables container networking, mounts
only this project at `/project`, and uses a dedicated SDK cache volume. The
Lima VM itself mounts the containing workspace through virtiofs. Runtime build
reports record the source fingerprint, compiler version, commands, elapsed
times and output hashes. Always use fresh output directories.

All task scratch belongs under `defuss-vm/tmp`. The host wrapper creates a short
retained `tmp/r-*` directory and sets `TMPDIR`, `TMP` and `TEMP` before starting
the command. SDK containers receive explicit variables pointing to their own
`/project/tmp/sdk-*` directory; inherited host paths are not valid container
paths. Both wrappers retain durable invocation records. Keep source, build
outputs, reports and [verified checkpoints](../scripts/CHECKPOINTS.md) outside
scratch. Use the checkpoint utility after milestones and before long campaigns.

Lima's socket path must fit the Unix socket limit. A symlink from `/tmp` to a
long workspace path does not solve that limit because Lima resolves the path.
The short persistent path above avoids both the socket limit and temporary
storage loss. The initial rejected long-path attempt was left under
`artifacts/build-host/lima`; it is not the running instance.

Run SDK builds, packaging and measured guest VMs serially. Check the instance
with `limactl list` using the same `LIMA_HOME`; stop only this owned instance
when it is idle. The sustained-v2 timing protocol requires this compiler VM to
be stopped before and after every measurement. Never remove retained artifacts to recover disk
space, and never rewrite an earlier failed or interrupted build report.
