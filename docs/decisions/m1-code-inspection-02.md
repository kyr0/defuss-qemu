# M1 code inspection 02: integer recurrence bytes and observed backedge

Status: diagnostic evidence, 7 November 2026. Stopped phase-end bytes at the
dominant integer PCs match the original recurrence's XOR, 32-bit multiply/add,
loop-index increment and 250,000 exit threshold. The two observed compiled-entry
addresses align with a conditional loop body and an unconditional backedge.
The same 40-byte loop body was captured after all three integer batches in both
the cold and restored runs, at different addresses in the two runs.

This resolves the concrete code-shape question left by
[pilot 02](m1-pilot-02.md). It does not establish historical code generations,
JSC tier, a correct region implementation, or a performance improvement. The
next engine gate is the [one-TB scaffold](m3a-one-tb-design.md), with precise
state recovery, invalidation and service checks before any fusion.

## Evidence and validation

The [frozen campaign](../../artifacts/m1-code-campaign-02/plan.json) ran one
fresh capture with sampling period 257 and one dependent fresh-browser restore
with period 263. Both passed all original workload answers and snapshot
continuation checks. Code inspection adds substantial stopped time and can
change later phases; these observations are excluded from the matched timing
and sampling-sensitivity analyzers.

| Observation | Captured windows | Unresolved | Independent evidence checks |
| --- | ---: | ---: | ---: |
| [Capture disassembly](../../artifacts/m1-code-disassembly-02/report.json) | 98 | 0 | [4,197](../../artifacts/m1-code-disassembly-02/independent-review.json) |
| [Restore disassembly](../../artifacts/m1-code-disassembly-restore-02/report.json) | 104 | 0 | [4,403](../../artifacts/m1-code-disassembly-restore-02/independent-review.json) |

Each window is 128 bytes. The independent Python reviewer replays the recorded
four-level page entries from their raw little-endian bytes, verifies entry
addresses and permissions, reconstructs physical addresses and cross-page
segments, and rehashes the complete code windows. It also checks the register
text against the parsed mode, physical-read bounds/accounting, and that each
capture occurs between confirmed stop and the next ACK. It does not import the
JavaScript walker or the disassembler.

The capture's last integer phase selected only the two eligible addresses;
the other capture phases selected eight each. Hence 98 windows is the complete
bounded selection, not six dropped reads. The restore selected eight per phase.
The raw code-window, page-table and source provenance remains in the reports
identified by [recurrence-evidence.json](../../artifacts/m1-code-disassembly-02/recurrence-evidence.json):

| Raw report | SHA256 |
| --- | --- |
| Capture | `f383f7679502dc6d148b235574484baa20f13cecd9610b60adf1dd9109b526dc` |
| Restore | `5b42c696fb13bb12a5086b5c1f270b86bbc8a828ca951ae043993c3724d743a1` |

The first inspection campaign is preserved as a failure. Its workload checks
passed, but Emscripten rejected the Node-style `"wx"` file-open mode before the
first page entry could be read. The retained
[failure review](../../artifacts/m1-code-disassembly-01/independent-review.json)
records 104 unresolved capture rows and zero code bytes. The fixed reader uses
numeric `O_WRONLY | O_CREAT | O_EXCL` flags; its behavior was checked against the
[actual candidate runtime FS](../../artifacts/m1-code-fs-validation-02.json)
before this fresh campaign. The old evidence and source archive were retained.

## Exact loop shape

| Run | Body entry A | Backedge entry B | Raw CR3 |
| --- | --- | --- | --- |
| Capture | `0x7f49a2e7a6a9` | `0x7f49a2e7a6c8` | `0x2960000` |
| Restore | `0x7f49a2e7a489` | `0x7f49a2e7a4a8` | `0x2960000` |

Both directions appear in each integer phase's sampled edge table under the
matching raw CR3. The retained bytes decode as:

```asm
A: sar  rax, 12
   xor  eax, ecx
   imul eax, eax, 1664525
   add  eax, 1013904223
   inc  ecx
   cmp  ecx, 250000
   jge  exit
B: shl  rax, 12
   jmp  A
exit:
```

A is 31 bytes; B is 9 bytes. The conditional displacement targets `A + 40`,
and the unconditional displacement returns to A. The independently read
B-window prefix agrees with the overlapping bytes of the A window. The six
40-byte body hashes are identical:

`33bf7bb51940030c9f3a4f6b6b60a50d813563a0f0bb03af0a47248cf26368a6`

The constants are `0x19660d`, `0x3c6ef35f` and `0x3d090`, respectively. The
32-bit XOR/multiply/add and increment match the unchanged workload's dependent
u32 recurrence. The windows do not contain the original seed or loop-counter
initialization, so the byte inspection alone does not prove the initial values
or every dynamic iteration. The larger 128-byte windows include surrounding
code that differs between capture and restore; only the stated 40-byte body
is matched across those observations. Bounded disassembly may end in a partial
instruction beyond that body.

## Implication for region work

This is a concrete two-entry candidate with a conditional side exit and an
unconditional return edge. It supports measuring dispatch and architectural
state traffic around that shape. It does not authorize deleting the shifts,
flags, instruction boundaries or service points merely because the arithmetic
checksum can be reproduced. Interrupts, exceptions, invalidation and stop/resume
must recover the exact reference state at every supported observer.

Implement one existing TB as a region first. Keep the reference path selectable
and prove identical state/exits, lifetime/accounting and code invalidation.
Only then select the observed compatible two-block edge and test any retained
state or fusion under the required fault, interrupt, self-modifying-code and
suspended-continuation cases. Measure the eventual candidate uninstrumented and
confirm it with a separately frozen paired campaign.

These reads describe the bytes and page-table roots at each stopped phase end.
They cannot rule out earlier remapping or code replacement inside the measured
phase; equality with the stopped CPU's CR3 is not proof of process ownership.
The capture/restore pair shares one application-ready snapshot and is dependent
evidence. No whole-runtime performance result or complete M1 attribution gate
is claimed here.
