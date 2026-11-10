# Source contract for cached segment access flags

This source-only ABI2 change is based on the immutable M3b prepared source
`artifacts/m3b-source-01/source`, fingerprint
`b458c012278728289c39b971bb0a7d01fc2a15411eebb4124399d3d72d2551b1`.
No ABI1 capture is retrospectively accepted. The original OFF capture failed
its sticky context/continuity check; that report and all ABI1 sources remain
unchanged.

`target/i386/cpu.h:103` defines the complete segment access-attribute masks:
G(23), B(22), L(21), AVL(20), P(15), DPL(13..14), S(12), TYPE(8..11).
Their union is exactly `0x00f0ff00`. TYPE includes accessed, readable/writable,
conforming/expand-down and code/data classification as appropriate. The native
adapter statically asserts that its mask equals this union; it does not
discard any of these bits.

`target/i386/tcg/seg_helper.c:179` extracts the decoded limit from descriptor
e1 bits0..15 and e2 bits16..19, then applies G. `get_seg_base` at190 extracts
the cached base from e1 bits16..31 and e2 bits0..7 and24..31. Consequently the
complement `0xff0f00ff` of the access mask consists entirely of raw base/limit
encoding fragments. These are not independent access attributes.
`load_seg_cache_raw_dt` stores the full e2 in `SegmentCache.flags` while also
storing its decoded base and limit. Descriptor-loading paths pass the same
e2 to `cpu_x86_load_seg_cache`, which stores selector/base/limit/flags separately
(`cpu.h:2607`). The census retains selector, full cached base and decoded limit
as exact independent fields for ES/CS/SS/DS/FS/GS/LDT/TR.

In contrast, `helper_sysret` (`seg_helper.c:1108`) creates user CS/SS caches
using base0, limit0xffffffff and only the named access masks. For the relevant
64-bit return, CS.flags is0x00a0fb00 and SS.flags is0x00c0f300. A descriptor
load with the same cached base, decoded limit and access attributes can retain
the raw limit-high nibble, yielding0x00affb00 and0x00cff300. This explains the
exact two-word difference observed at failed ABI1 OFF warm gate5 without
requiring any architectural segment change. It is a source-backed explanation
of that representation difference, not an inference that the full run passed.

QEMU itself uses the same canonical access mask when saving/restoring segment
attributes in SMM (`target/i386/tcg/system/smm_helper.c:39`,50,58 and222/230):
`(flags >> 8) & 0xf0ff`. The census candidate still excludes SMM; this is an
independent source precedent for the attribute encoding. The diagnostic CPU
dump (`target/i386/cpu-dump.c:106`) prints `flags & 0x00ffff00`, so its text
can include the redundant limit nibble. Host ABI2 parsing must retain raw
printed values, derive canonical access flags using0x00f0ff00, and compare
the independently printed selector/base/decoded limit exactly. It must not
require every later raw print to equal an earlier raw descriptor copy.

ABI2 preserves the eight raw `SegmentCache.flags` words at tuple90..97.
Existing segment flags positions contain the canonical attributes. Same-kind
and cross-kind continuity exclude only those eight raw copies; all other
existing rules remain, including exact canonical flags, owner/generation,
pages, cflags, selectors, bases, limits, control state and reserved words98..111.
The raw copies must satisfy `canonical == raw & 0x00f0ff00` in every retained
tuple. The first tuple remains first evidence; a later equivalent raw encoding
does not replace it. The typed generation-specific injection API is unchanged.

The host contract compiles the actual adapter/core/API and extracted dispatch
sites with ASan/UBSan. Its new segment tests use the actual extracted QEMU
`get_seg_base`/`get_seg_limit` functions, exercise the exact CS/SS pair, every
retained access bit in all eight segment caches, every excluded encoding bit,
and independent selector/base/decoded-limit changes. Tests and SDK/runtime
validation for this fresh ABI2 source have not yet run.
