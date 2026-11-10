# MSG1 timing after controller interruption

The first study ended when the chat turn was interrupted. Three captures had
controller exit receipts. A fourth capture finished independently and retained
a passing report, but its process exit status is unknown. All four captures
and the stale lock are preserved in the original paths and the interruption
record. They are not pooled with this study.

This study repeats the fixed six-block, eighteen-launch design with fresh
capture paths and nonces. It retains the exact original measurement harness,
runtime binaries, guest package, primary SHA metric and statistical thresholds.
The restart decision is administrative and was made without selecting on a
performance result. The six orders remain unchanged. No capture is retried
after a failure. The controller runs detached through VAE's job registry.

Host conditions are observed for every capture. The host was busy during
preparation; this study does not assume zero load or infer deoptimization from
a slowdown. Builds, guest VMs and checkpoints remain serial. The capture
deadline stays thirty minutes. Candidate selection still requires independent
confirmation, and the remaining resource and platform gates remain open.
