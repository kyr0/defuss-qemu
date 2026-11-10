/* Immutable, preloaded media for Wasm guests. SPDX-License-Identifier: GPL-2.0-or-later */
#include "qemu/osdep.h"
#include "qapi/error.h"
#include "qemu/module.h"
#include "block/block_int.h"
#include <emscripten.h>
#include <zlib.h>
#include "qemu/bswap.h"
#include "qemu/thread.h"

static uint8_t *image;
static uint32_t image_size;

/* A gzip restart interval is independent of its neighbors. Only its compressed
 * bytes and a bounded decoded working set are kept in the Wasm instance. */
enum { ROM_CHUNK = 256 * 1024, ROM_SLOTS = 32 };
typedef struct RomSlot {
    uint8_t *data;
    uint32_t chunk;
    uint64_t age;
} RomSlot;
static RomSlot slots[ROM_SLOTS];
static uint32_t *offsets;
static uint32_t chunk_count;
static uint64_t age;
static QemuMutex cache_lock;
static uint32_t read_count, requested_bytes, inflated_bytes, misses;

EMSCRIPTEN_KEEPALIVE uint32_t defuss_rom_counter(int which);
EMSCRIPTEN_KEEPALIVE uint32_t defuss_rom_counter(int which)
{
    switch (which) {
    case 0: return qatomic_read(&read_count);
    case 1: return qatomic_read(&requested_bytes);
    case 2: return qatomic_read(&inflated_bytes);
    case 3: return qatomic_read(&misses);
    default: return 0;
    }
}

EMSCRIPTEN_KEEPALIVE int defuss_stage_indexed(uint32_t packed, uint32_t isize);
EMSCRIPTEN_KEEPALIVE int defuss_stage_indexed(uint32_t packed, uint32_t isize)
{
    g_autofree uint8_t *data = NULL, *idx = NULL;
    uint32_t size, n, previous = 0;

    if (image || packed < 18 || isize < 24 || isize > 1024 * 1024) {
        return 0;
    }
    data = g_try_malloc(packed);
    idx = g_try_malloc(isize);
    if (!data || !idx || !EM_ASM_INT({
        const b = Module.defussDiskImage; const index = Module.defussDiskIndex;
        if (!b || !index || b.length !== Number($1) ||
            index.length !== Number($3)) return 0;
        HEAPU8.set(b, Number($0));
        HEAPU8.set(index, Number($2));
        return 1;
    }, data, packed, idx, isize)) {
        return 0;
    }
    size = ldl_le_p(idx + 4);
    n = ldl_le_p(idx + 12);
    if (memcmp(idx, "DFG1", 4) || !size || (size & 511) ||
        ldl_le_p(idx + 8) != ROM_CHUNK ||
        n != DIV_ROUND_UP((uint64_t)size, ROM_CHUNK) ||
        isize != 16 + (n + 1) * 4 ||
        ldl_le_p(idx + 16) != 10 || ldl_le_p(idx + 16 + n * 4) != packed - 8) {
        return 0;
    }
    for (uint32_t i = 0; i <= n; i++) {
        uint32_t offset = ldl_le_p(idx + 16 + i * 4);
        if (offset <= previous || offset > packed - 8) {
            return 0;
        }
        previous = offset;
    }
    offsets = g_new(uint32_t, n + 1);
    for (uint32_t i = 0; i <= n; i++) {
        offsets[i] = ldl_le_p(idx + 16 + i * 4);
    }
    chunk_count = n;
    qemu_mutex_init(&cache_lock);
    image = g_steal_pointer(&data);
    image_size = size;
    return 1;
}

/* Called on the main JS thread in preRun, before QEMU starts its workers. */
EMSCRIPTEN_KEEPALIVE int defuss_stage_rom(uint32_t size);
EMSCRIPTEN_KEEPALIVE int defuss_stage_rom(uint32_t size)
{
    if (image || !size || (size & 511)) {
        return 0;
    }
    uint8_t *data = g_try_malloc(size);
    if (!data) {
        return 0;
    }
    int ok = EM_ASM_INT({
        const bytes = Module.defussDiskImage;
        if (!bytes || bytes.byteLength !== Number($1)) return 0;
        HEAPU8.set(bytes, Number($0));
        return 1;
    }, data, size);
    if (!ok) {
        g_free(data);
        return 0;
    }
    image = data;
    image_size = size;
    return 1;
}

static void rom_parse(const char *filename, QDict *options, Error **errp)
{
    if (strcmp(filename, "wasmrom:bun")) {
        error_setg(errp, "Expected wasmrom:bun");
    }
}

static int rom_open(BlockDriverState *bs, QDict *options, int flags, Error **errp)
{
    if (!image || (flags & BDRV_O_RDWR)) {
        error_setg(errp, "wasmrom requires staged read-only media");
        return -EINVAL;
    }
    return 0;
}

static int64_t coroutine_fn rom_length(BlockDriverState *bs)
{
    return image_size;
}

/* Called with cache_lock held. A slot is published only after a full decode. */
static RomSlot *rom_chunk(uint32_t chunk)
{
    RomSlot *slot = &slots[0];
    for (unsigned i = 0; i < ROM_SLOTS; i++) {
        RomSlot *p = &slots[i];
        if (p->age && p->chunk == chunk) {
            p->age = ++age;
            return p;
        }
        if (p->age < slot->age) {
            slot = p;
        }
    }
    slot->age = 0;
    if (!slot->data) {
        slot->data = g_try_malloc(ROM_CHUNK);
        if (!slot->data) {
            return NULL;
        }
    }
    uint32_t size = MIN(ROM_CHUNK, image_size - chunk * ROM_CHUNK);
    z_stream stream = { .next_in = image + offsets[chunk],
                        .avail_in = offsets[chunk + 1] - offsets[chunk],
                        .next_out = slot->data, .avail_out = size };
    if (inflateInit2(&stream, -MAX_WBITS) != Z_OK) {
        return NULL;
    }
    int ret = inflate(&stream, Z_NO_FLUSH);
    inflateEnd(&stream);
    if ((ret != Z_OK && ret != Z_STREAM_END) || stream.total_out != size) {
        return NULL;
    }
    slot->chunk = chunk;
    slot->age = ++age;
    qatomic_add(&inflated_bytes, size);
    qatomic_inc(&misses);
    return slot;
}

static int coroutine_fn rom_read(BlockDriverState *bs, int64_t offset, int64_t bytes,
                                 QEMUIOVector *qiov, BdrvRequestFlags flags)
{
    if (offset < 0 || bytes < 0 || offset > image_size || bytes > image_size - offset) {
        return -EIO;
    }
    qatomic_inc(&read_count);
    qatomic_add(&requested_bytes, bytes);
    if (!offsets) {
        return qemu_iovec_from_buf(qiov, 0, image + offset, bytes) == bytes ? 0 : -EIO;
    }
    QEMU_LOCK_GUARD(&cache_lock);
    size_t done = 0;
    while (bytes > 0) {
        uint32_t chunk = offset / ROM_CHUNK, within = offset % ROM_CHUNK;
        size_t n = MIN(bytes, ROM_CHUNK - within);
        RomSlot *slot = chunk < chunk_count ? rom_chunk(chunk) : NULL;
        if (!slot || qemu_iovec_from_buf(qiov, done, slot->data + within, n) != n) {
            return -EIO;
        }
        offset += n;
        done += n;
        bytes -= n;
    }
    return 0;
}

static BlockDriver wasm_rom = {
    .format_name = "wasmrom",
    .protocol_name = "wasmrom",
    .bdrv_open = rom_open,
    .bdrv_parse_filename = rom_parse,
    .bdrv_co_getlength = rom_length,
    .bdrv_co_preadv = rom_read,
};

static void register_wasm_rom(void)
{
    bdrv_register(&wasm_rom);
}
block_init(register_wasm_rom);
