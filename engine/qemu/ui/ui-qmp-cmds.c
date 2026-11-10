/*
 * QMP commands related to UI
 *
 * Copyright IBM, Corp. 2011
 *
 * Authors:
 *  Anthony Liguori   <aliguori@us.ibm.com>
 *
 * This work is licensed under the terms of the GNU GPL, version 2.  See
 * the COPYING file in the top-level directory.
 *
 * Contributions after 2012-01-13 are licensed under the terms of the
 * GNU GPL, version 2 or (at your option) any later version.
 */

#include "qemu/osdep.h"

#include "io/channel-file.h"
#include "monitor/qmp-helpers.h"
#include "qapi/qapi-commands-ui.h"
#include "qapi/qmp/qerror.h"
#include "qemu/coroutine.h"
#include "qemu/main-loop.h"
#include "qemu/cutils.h"
#include "trace.h"
#include "ui/console.h"
#include "ui/dbus-display.h"
#include "ui/qemu-spice.h"
#ifdef CONFIG_PNG
#include <png.h>
#endif

void qmp_set_password(SetPasswordOptions *opts, Error **errp)
{
    if (opts->protocol == DISPLAY_PROTOCOL_SPICE) {
        if (!qemu_using_spice(errp)) {
            return;
        }
        qemu_spice.set_passwd(opts->password,
                              opts->connected == SET_PASSWORD_ACTION_FAIL,
                              opts->connected == SET_PASSWORD_ACTION_DISCONNECT,
                              errp);
    } else {
        assert(opts->protocol == DISPLAY_PROTOCOL_VNC);
        if (opts->connected != SET_PASSWORD_ACTION_KEEP) {
            /* vnc supports "connected=keep" only */
            error_setg(errp, "parameter 'connected' must be 'keep'"
                       " when 'protocol' is 'vnc'");
            return;
        }
        /*
         * Note that setting an empty password will not disable login
         * through this interface.
         */
        vnc_display_password(opts->u.vnc.display, opts->password, errp);
    }
}

void qmp_expire_password(ExpirePasswordOptions *opts, Error **errp)
{
    time_t when;
    int rc;
    const char *whenstr = opts->time;
    const char *numstr = NULL;
    uint64_t num;

    if (strcmp(whenstr, "now") == 0) {
        when = 0;
    } else if (strcmp(whenstr, "never") == 0) {
        when = TIME_MAX;
    } else if (whenstr[0] == '+') {
        when = time(NULL);
        numstr = whenstr + 1;
    } else {
        when = 0;
        numstr = whenstr;
    }

    if (numstr) {
        if (qemu_strtou64(numstr, NULL, 10, &num) < 0) {
            error_setg(errp, "Parameter 'time' doesn't take value '%s'",
                       whenstr);
            return;
        }
        when += num;
    }

    if (opts->protocol == DISPLAY_PROTOCOL_SPICE) {
        if (!qemu_using_spice(errp)) {
            return;
        }
        rc = qemu_spice.set_pw_expire(when);
    } else {
        assert(opts->protocol == DISPLAY_PROTOCOL_VNC);
        rc = vnc_display_pw_expire(opts->u.vnc.display, when);
    }

    if (rc != 0) {
        error_setg(errp, "Could not set password expire time");
    }
}

#ifdef CONFIG_VNC
void qmp_change_vnc_password(const char *password, Error **errp)
{
    vnc_display_password(NULL, password, errp);
}
#endif

bool qmp_add_client_spice(int fd, bool has_skipauth, bool skipauth,
                          bool has_tls, bool tls, Error **errp)
{
    if (!qemu_using_spice(errp)) {
        return false;
    }
    skipauth = has_skipauth ? skipauth : false;
    tls = has_tls ? tls : false;
    if (qemu_spice.display_add_client(fd, skipauth, tls) < 0) {
        error_setg(errp, "spice failed to add client");
        return false;
    }
    return true;
}

#ifdef CONFIG_VNC
bool qmp_add_client_vnc(int fd, bool has_skipauth, bool skipauth,
                        bool has_tls, bool tls, Error **errp)
{
    skipauth = has_skipauth ? skipauth : false;
    vnc_display_add_client(NULL, fd, skipauth);
    return true;
}
#endif

#ifdef CONFIG_DBUS_DISPLAY
bool qmp_add_client_dbus_display(int fd, bool has_skipauth, bool skipauth,
                                 bool has_tls, bool tls, Error **errp)
{
    if (!qemu_using_dbus_display(errp)) {
        return false;
    }
    if (!qemu_dbus_display.add_client(fd, errp)) {
        return false;
    }
    return true;
}
#endif

void qmp_display_reload(DisplayReloadOptions *arg, Error **errp)
{
    switch (arg->type) {
    case DISPLAY_RELOAD_TYPE_VNC:
#ifdef CONFIG_VNC
        if (arg->u.vnc.has_tls_certs && arg->u.vnc.tls_certs) {
            vnc_display_reload_certs(NULL, errp);
        }
#else
        error_setg(errp, "vnc is invalid, missing 'CONFIG_VNC'");
#endif
        break;
    default:
        abort();
    }
}

void qmp_display_update(DisplayUpdateOptions *arg, Error **errp)
{
    switch (arg->type) {
    case DISPLAY_UPDATE_TYPE_VNC:
#ifdef CONFIG_VNC
        vnc_display_update(&arg->u.vnc, errp);
#else
        error_setg(errp, "vnc is invalid, missing 'CONFIG_VNC'");
#endif
        break;
    default:
        abort();
    }
}

void qmp_client_migrate_info(const char *protocol, const char *hostname,
                             bool has_port, int64_t port,
                             bool has_tls_port, int64_t tls_port,
                             const char *cert_subject,
                             Error **errp)
{
    if (strcmp(protocol, "spice") == 0) {
        if (!qemu_using_spice(errp)) {
            return;
        }

        if (!has_port && !has_tls_port) {
            error_setg(errp, "parameter 'port' or 'tls-port' is required");
            return;
        }

        if (qemu_spice.migrate_info(hostname,
                                    has_port ? port : -1,
                                    has_tls_port ? tls_port : -1,
                                    cert_subject)) {
            error_setg(errp, "Could not set up display for migration");
            return;
        }
        return;
    }

    error_setg(errp, QERR_INVALID_PARAMETER_VALUE, "protocol", "'spice'");
}

#if defined(CONFIG_PIXMAN) || defined(__EMSCRIPTEN__)
#if defined(CONFIG_PNG) && defined(CONFIG_PIXMAN)
/**
 * png_save: Take a screenshot as PNG
 *
 * Saves screendump as a PNG file
 *
 * Returns true for success or false for error.
 *
 * @fd: File descriptor for PNG file.
 * @image: Image data in pixman format.
 * @errp: Pointer to an error.
 */
static bool png_save(int fd, pixman_image_t *image, Error **errp)
{
    int width = pixman_image_get_width(image);
    int height = pixman_image_get_height(image);
    png_struct *png_ptr;
    png_info *info_ptr;
    g_autoptr(pixman_image_t) linebuf =
        qemu_pixman_linebuf_create(PIXMAN_BE_r8g8b8, width);
    uint8_t *buf = (uint8_t *)pixman_image_get_data(linebuf);
    FILE *f = fdopen(fd, "wb");
    int y;
    if (!f) {
        error_setg_errno(errp, errno,
                         "Failed to create file from file descriptor");
        return false;
    }

    png_ptr = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL,
                                      NULL, NULL);
    if (!png_ptr) {
        error_setg(errp, "PNG creation failed. Unable to write struct");
        fclose(f);
        return false;
    }

    info_ptr = png_create_info_struct(png_ptr);

    if (!info_ptr) {
        error_setg(errp, "PNG creation failed. Unable to write info");
        fclose(f);
        png_destroy_write_struct(&png_ptr, &info_ptr);
        return false;
    }

    png_init_io(png_ptr, f);

    png_set_IHDR(png_ptr, info_ptr, width, height, 8,
                 PNG_COLOR_TYPE_RGB, PNG_INTERLACE_NONE,
                 PNG_COMPRESSION_TYPE_BASE, PNG_FILTER_TYPE_BASE);

    png_write_info(png_ptr, info_ptr);

    for (y = 0; y < height; ++y) {
        qemu_pixman_linebuf_fill(linebuf, image, width, 0, y);
        png_write_row(png_ptr, buf);
    }

    png_write_end(png_ptr, NULL);

    png_destroy_write_struct(&png_ptr, &info_ptr);

    if (fclose(f) != 0) {
        error_setg_errno(errp, errno,
                         "PNG creation failed. Unable to close file");
        return false;
    }

    return true;
}

#else /* no png support */

static bool png_save(int fd, pixman_image_t *image, Error **errp)
{
    error_setg(errp, "Enable PNG support with libpng for screendump");
    return false;
}

#endif /* CONFIG_PNG */

#ifndef CONFIG_PIXMAN
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <wasm_simd128.h>
#define DISPLAY65_EXPORT EMSCRIPTEN_KEEPALIVE
#define DISPLAY66_SIMD __attribute__((target("simd128")))
#else
#define DISPLAY65_EXPORT
#define DISPLAY66_SIMD
#endif
/* Pure pixel conversion: no imports, allocation, callbacks or suspension. */
DISPLAY65_EXPORT DISPLAY66_SIMD void defuss65_rgb24_frame(uint8_t *rgb,
    const uint8_t *data, int width, int height, int stride, int bytes,
    unsigned rs, unsigned gs, unsigned bs, uint32_t rm, uint32_t gm, uint32_t bm);
DISPLAY65_EXPORT DISPLAY66_SIMD void defuss65_rgb24_frame(uint8_t *rgb,
    const uint8_t *data, int width, int height, int stride, int bytes,
    unsigned rs, unsigned gs, unsigned bs, uint32_t rm, uint32_t gm, uint32_t bm)
{
    bool rgb888 = rm == 255 && gm == 255 && bm == 255;
    for (int y = 0; y < height; y++) {
        const uint8_t *row = data + (ptrdiff_t)y * stride;
        uint8_t *out = rgb + (size_t)y * width * 3;
        int x = 0;
#ifdef __EMSCRIPTEN__
        /* Source/destination are separate screenshot buffers. Load four exact
         * pixels and write only 12 bytes, including at the memory boundary. */
        if (bytes == 4 && rgb888 && gs == 8 &&
            ((rs == 16 && bs == 0) || (rs == 0 && bs == 16))) {
            for (; x < (width & -4); x += 4) {
                v128_t v = wasm_v128_load(row + (size_t)x * 4);
                v128_t zero = wasm_i32x4_splat(0);
                v128_t packed;
                if (rs == 16) {
                    packed = wasm_i8x16_shuffle(v, zero,
                        2, 1, 0, 6, 5, 4, 10, 9, 8, 14, 13, 12, 16, 17, 18, 19);
                } else {
                    packed = wasm_i8x16_shuffle(v, zero,
                        0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19);
                }
                wasm_v128_store64_lane(out + (size_t)x * 3, packed, 0);
                wasm_v128_store32_lane(out + (size_t)x * 3 + 8, packed, 2);
            }
        }
#endif
        for (; x < width; x++) {
            const uint8_t *p = row + (size_t)x * bytes;
            uint32_t v = p[0] | (uint32_t)p[1] << 8;
            if (bytes > 2) {
                v |= (uint32_t)p[2] << 16;
            }
            if (bytes == 4) {
                v |= (uint32_t)p[3] << 24;
            }
            if (rgb888) {
                out[3*x] = v >> rs;
                out[3*x+1] = v >> gs;
                out[3*x+2] = v >> bs;
            } else {
                out[3*x] = ((v >> rs) & rm) * 255 / rm;
                out[3*x+1] = ((v >> gs) & gm) * 255 / gm;
                out[3*x+2] = ((v >> bs) & bm) * 255 / bm;
            }
        }
    }
}

DISPLAY65_EXPORT unsigned defuss65_display(void);
DISPLAY65_EXPORT unsigned defuss65_display(void)
{
    return 1;
}
DISPLAY65_EXPORT unsigned defuss66_display_simd(void);

DISPLAY65_EXPORT unsigned defuss66_display_simd(void)
{
#ifdef __EMSCRIPTEN__
    return 1;
#else
    return 0;
#endif
}

/* v69 transport experiment: native-owned, packed RGBA frames. The QMP
 * coroutine publishes after taking the same console/image reference as the
 * PPM path. Consumers must finish reading before the next capture. */
static uint8_t *defuss69_pixels;
static size_t defuss69_capacity;
static uint8_t *defuss69_previous;
static size_t defuss69_previous_capacity;
static unsigned defuss69_previous_w, defuss69_previous_h;
static bool defuss69_previous_valid;
static unsigned defuss69_w, defuss69_h, defuss69_row_bytes, defuss69_seq;
static unsigned defuss69_dirty_y, defuss69_dirty_h;
uint64_t defuss69_display_generation;
static uint64_t defuss69_last_capture_generation;

DISPLAY65_EXPORT void *defuss69_frame(void);
DISPLAY65_EXPORT unsigned defuss69_width(void);
DISPLAY65_EXPORT unsigned defuss69_height(void);
DISPLAY65_EXPORT unsigned defuss69_stride(void);
DISPLAY65_EXPORT unsigned defuss69_sequence(void);

DISPLAY65_EXPORT void defuss69_rgba_frame(uint8_t *rgba,
    const uint8_t *data, int width, int height, int stride, int bytes,
    unsigned rs, unsigned gs, unsigned bs, uint32_t rm, uint32_t gm, uint32_t bm);
DISPLAY65_EXPORT void defuss69_rgba_frame(uint8_t *rgba,
    const uint8_t *data, int width, int height, int stride, int bytes,
    unsigned rs, unsigned gs, unsigned bs, uint32_t rm, uint32_t gm, uint32_t bm)
{
    bool rgb888 = rm == 255 && gm == 255 && bm == 255;
    for (int y = 0; y < height; y++) {
        const uint8_t *row = data + (ptrdiff_t)y * stride;
        uint8_t *out = rgba + (size_t)y * width * 4;
        int x = 0;
#ifdef __EMSCRIPTEN__
        if (bytes == 4 && rgb888 && gs == 8 &&
            ((rs == 16 && bs == 0) || (rs == 0 && bs == 16))) {
            v128_t alpha = wasm_i32x4_splat(-1);
            for (; x < (width & -4); x += 4) {
                v128_t v = wasm_v128_load(row + (size_t)x * 4), packed;
                if (rs == 16) {
                    packed = wasm_i8x16_shuffle(v, alpha,
                        2, 1, 0, 16, 6, 5, 4, 16,
                        10, 9, 8, 16, 14, 13, 12, 16);
                } else {
                    packed = wasm_i8x16_shuffle(v, alpha,
                        0, 1, 2, 16, 4, 5, 6, 16,
                        8, 9, 10, 16, 12, 13, 14, 16);
                }
                wasm_v128_store(out + (size_t)x * 4, packed);
            }
        }
#endif
        for (; x < width; x++) {
            const uint8_t *p = row + (size_t)x * bytes;
            uint32_t v = p[0] | (uint32_t)p[1] << 8;
            if (bytes > 2) {
                v |= (uint32_t)p[2] << 16;
            }
            if (bytes == 4) {
                v |= (uint32_t)p[3] << 24;
            }
            if (rgb888) {
                out[4*x] = v >> rs;
                out[4*x+1] = v >> gs;
                out[4*x+2] = v >> bs;
            } else {
                out[4*x] = ((v >> rs) & rm) * 255 / rm;
                out[4*x+1] = ((v >> gs) & gm) * 255 / gm;
                out[4*x+2] = ((v >> bs) & bm) * 255 / bm;
            }
            out[4*x+3] = 255;
        }
    }
}

DISPLAY65_EXPORT void *defuss69_frame(void) { return defuss69_pixels; }
DISPLAY65_EXPORT unsigned defuss69_width(void) { return defuss69_w; }
DISPLAY65_EXPORT unsigned defuss69_height(void) { return defuss69_h; }
DISPLAY65_EXPORT unsigned defuss69_stride(void) { return defuss69_row_bytes; }
DISPLAY65_EXPORT unsigned defuss69_sequence(void)
{
    return __atomic_load_n(&defuss69_seq, __ATOMIC_ACQUIRE);
}

static bool defuss69_publish(pixman_image_t *image, Error **errp)
{
    const int width = pixman_image_get_width(image);
    const int height = pixman_image_get_height(image);
    const uint8_t *data = (const uint8_t *)pixman_image_get_data(image);
    const int stride = pixman_image_get_stride(image);
    const pixman_format_code_t format = pixman_image_get_format(image);
    const int depth = PIXMAN_FORMAT_BPP(format);
    const int type = PIXMAN_FORMAT_TYPE(format);
    const int r = PIXMAN_FORMAT_R(format), g = PIXMAN_FORMAT_G(format);
    const int b = PIXMAN_FORMAT_B(format);
    if (width <= 0 || height <= 0 || width > 16384 || height > 16384 ||
        (depth != 16 && depth != 24 && depth != 32) || !r || !g || !b ||
        (type != PIXMAN_TYPE_ARGB && type != PIXMAN_TYPE_ABGR)) {
        error_setg(errp, "Unsupported direct RGBA frame format 0x%x", format);
        return false;
    }
    const size_t needed = (size_t)width * height * 4;
    if (needed > defuss69_capacity) {
        defuss69_pixels = g_realloc(defuss69_pixels, needed);
        defuss69_capacity = needed;
    }
    const uint32_t rm = (1u << r) - 1, gm = (1u << g) - 1, bm = (1u << b) - 1;
    const unsigned rs = type == PIXMAN_TYPE_ARGB ? g + b : 0;
    const unsigned gs = type == PIXMAN_TYPE_ARGB ? b : r;
    const unsigned bs = type == PIXMAN_TYPE_ARGB ? 0 : g + r;
    defuss69_rgba_frame(defuss69_pixels, data, width, height, stride,
                        depth / 8, rs, gs, bs, rm, gm, bm);
    if (defuss69_previous_valid && defuss69_previous_w == (unsigned)width &&
        defuss69_previous_h == (unsigned)height) {
        const size_t row_bytes = (size_t)width * 4;
        unsigned first = 0, last = height;
        while (first < (unsigned)height &&
               memcmp(defuss69_pixels + (size_t)first * row_bytes,
                      defuss69_previous + (size_t)first * row_bytes, row_bytes) == 0) {
            first++;
        }
        if (first == (unsigned)height) {
            defuss69_dirty_y = 0;
            defuss69_dirty_h = 0;
        } else {
            while (last > first &&
                   memcmp(defuss69_pixels + (size_t)(last - 1) * row_bytes,
                          defuss69_previous + (size_t)(last - 1) * row_bytes,
                          row_bytes) == 0) {
                last--;
            }
            defuss69_dirty_y = first;
            defuss69_dirty_h = last - first;
        }
    } else {
        defuss69_dirty_y = 0;
        defuss69_dirty_h = height;
    }
    if (needed > defuss69_previous_capacity) {
        defuss69_previous = g_realloc(defuss69_previous, needed);
        defuss69_previous_capacity = needed;
    }
    memcpy(defuss69_previous, defuss69_pixels, needed);
    defuss69_previous_w = width;
    defuss69_previous_h = height;
    defuss69_previous_valid = true;
    defuss69_w = width;
    defuss69_h = height;
    defuss69_row_bytes = width * 4;
    defuss69_last_capture_generation = defuss69_display_generation;
    __atomic_store_n(&defuss69_seq, defuss69_seq + 1, __ATOMIC_RELEASE);
    return true;
}
#undef DISPLAY66_SIMD
#undef DISPLAY65_EXPORT
#endif

static bool ppm_save(int fd, pixman_image_t *image, Error **errp)
{
    int width = pixman_image_get_width(image);
    int height = pixman_image_get_height(image);
    g_autoptr(Object) ioc = OBJECT(qio_channel_file_new_fd(fd));
    g_autofree char *header = NULL;
#ifdef CONFIG_PIXMAN
    g_autoptr(pixman_image_t) linebuf = NULL;
    int y;
#else
    g_autofree uint8_t *rgb = g_malloc_n(width, (size_t)height * 3);
#endif

    trace_ppm_save(fd, image);

    header = g_strdup_printf("P6\n%d %d\n%d\n", width, height, 255);
    if (qio_channel_write_all(QIO_CHANNEL(ioc),
                              header, strlen(header), errp) < 0) {
        return false;
    }

#ifdef CONFIG_PIXMAN
    linebuf = qemu_pixman_linebuf_create(PIXMAN_BE_r8g8b8, width);
    for (y = 0; y < height; y++) {
        qemu_pixman_linebuf_fill(linebuf, image, width, 0, y);
        if (qio_channel_write_all(QIO_CHANNEL(ioc),
                                  (char *)pixman_image_get_data(linebuf),
                                  pixman_image_get_stride(linebuf), errp) < 0) {
            return false;
        }
    }

#else
    /* Software VGA draws indexed modes into x8r8g8b8, but can expose
     * guest high-color framebuffer surfaces directly. Respect row stride. */
    const uint8_t *data = (const uint8_t *)pixman_image_get_data(image);
    const int stride = pixman_image_get_stride(image);
    const pixman_format_code_t format = pixman_image_get_format(image);
    int depth = PIXMAN_FORMAT_BPP(format);
    int type = PIXMAN_FORMAT_TYPE(format);
    int r = PIXMAN_FORMAT_R(format), g = PIXMAN_FORMAT_G(format);
    int b = PIXMAN_FORMAT_B(format);
    if ((depth != 16 && depth != 24 && depth != 32) || !r || !g || !b ||
        (type != PIXMAN_TYPE_ARGB && type != PIXMAN_TYPE_ABGR)) {
        error_setg(errp, "Unsupported software VGA format 0x%x", format);
        return false;
    }
    uint32_t rm = (1u << r) - 1, gm = (1u << g) - 1, bm = (1u << b) - 1;
    unsigned rs = type == PIXMAN_TYPE_ARGB ? g + b : 0;
    unsigned gs = type == PIXMAN_TYPE_ARGB ? b : r;
    unsigned bs = type == PIXMAN_TYPE_ARGB ? 0 : g + r;
    /* One frame write avoids a synchronous pthread-to-JS filesystem proxy
     * for every scanline. The allocation belongs to this coroutine. */
    defuss65_rgb24_frame(rgb, data, width, height, stride, depth / 8,
                        rs, gs, bs, rm, gm, bm);
    if (qio_channel_write_all(QIO_CHANNEL(ioc), (char *)rgb,
                              (size_t)width * height * 3, errp) < 0) {
        return false;
    }
#endif

    return true;
}

/* Safety: coroutine-only, concurrent-coroutine safe, main thread only */
void coroutine_fn
qmp_screendump(const char *filename, const char *device,
               bool has_head, int64_t head,
               bool has_format, ImageFormat format, Error **errp)
{
    g_autoptr(pixman_image_t) image = NULL;
    QemuConsole *con;
    DisplaySurface *surface;
    int fd;

    if (device) {
        con = qemu_console_lookup_by_device_name(device, has_head ? head : 0,
                                                 errp);
        if (!con) {
            return;
        }
    } else {
        if (has_head) {
            error_setg(errp, "'head' must be specified together with 'device'");
            return;
        }
        con = qemu_console_lookup_by_index(0);
        if (!con) {
            error_setg(errp, "There is no console to take a screendump from");
            return;
        }
    }

    object_ref(con);
    qemu_console_co_wait_update(con);

    /*
     * All pending coroutines are woken up, while the BQL is held.  No
     * further graphic update are possible until it is released.  Take
     * an image ref before that.
     */
    surface = qemu_console_surface(con);
    if (!surface) {
        error_setg(errp, "no surface");
        object_unref(con);
        return;
    }
    image = pixman_image_ref(surface->image);
    object_unref(con);

    fd = qemu_create(filename, O_WRONLY | O_TRUNC | O_BINARY, 0666, errp);
    if (fd == -1) {
        return;
    }

    /*
     * The image content could potentially be updated as the coroutine
     * yields and releases the BQL. It could produce corrupted dump, but
     * it should be otherwise safe.
     */
    if (has_format && format == IMAGE_FORMAT_PNG) {
        /* PNG format specified for screendump */
        if (!png_save(fd, image, errp)) {
            qemu_unlink(filename);
        }
    } else {
        /* PPM format specified/default for screendump */
        if (!ppm_save(fd, image, errp)) {
            qemu_unlink(filename);
        }
    }
}

/* Shared capture used by QMP and by the polling display ABI. */
static void coroutine_fn defuss69_capture(Error **errp)
{
    g_autoptr(pixman_image_t) image = NULL;
    QemuConsole *con = qemu_console_lookup_by_index(0);
    DisplaySurface *surface;
    if (!con) {
        error_setg(errp, "There is no console to take a screendump from");
        return;
    }
    object_ref(con);
    qemu_console_co_wait_update(con);
    surface = qemu_console_surface(con);
    if (!surface) {
        error_setg(errp, "no surface");
        object_unref(con);
        return;
    }
    image = pixman_image_ref(surface->image);
    object_unref(con);
    defuss69_publish(image, errp);
}

void coroutine_fn qmp_screendump_rgba(Error **errp)
{
    defuss69_capture(errp);
}

/* QMP-free polling transport. The descriptor is stable until the next start. */
typedef struct Defuss69DisplayFrame {
    uint64_t pixels;
    uint32_t width, height, stride, format, sequence, dirtyY, dirtyH, reserved;
} Defuss69DisplayFrame;

static Defuss69DisplayFrame defuss69_info;
static unsigned defuss69_poll_state;

EMSCRIPTEN_KEEPALIVE uint64_t defuss69_display_generation_value(void);
EMSCRIPTEN_KEEPALIVE uint64_t defuss69_display_generation_value(void)
{
    return __atomic_load_n(&defuss69_display_generation, __ATOMIC_ACQUIRE);
}

static void coroutine_fn defuss69_display_frame_co(void *opaque);
static void defuss69_display_frame_bh(void *opaque);

EMSCRIPTEN_KEEPALIVE int defuss69_display_frame(int start);
EMSCRIPTEN_KEEPALIVE void *defuss69_display_info(void);

EMSCRIPTEN_KEEPALIVE int defuss69_display_frame(int start)
{
    if (start) {
        if (__atomic_load_n(&defuss69_poll_state, __ATOMIC_ACQUIRE) == 2 &&
            defuss69_last_capture_generation == defuss69_display_generation) {
            defuss69_info.dirtyY = 0;
            defuss69_info.dirtyH = 0;
            return 1;
        }
        if (__atomic_load_n(&defuss69_poll_state, __ATOMIC_ACQUIRE) != 1) {
            __atomic_store_n(&defuss69_poll_state, 1, __ATOMIC_RELEASE);
            aio_bh_schedule_oneshot(qemu_get_aio_context(),
                                    defuss69_display_frame_bh, NULL);
        }
        return 0;
    }
    const unsigned state = __atomic_load_n(&defuss69_poll_state, __ATOMIC_ACQUIRE);
    if (state == 3) {
        return -1;
    }
    if (state != 2) {
        return 0;
    }
    defuss69_info.pixels = (uint64_t)(uintptr_t)defuss69_pixels;
    defuss69_info.width = defuss69_w;
    defuss69_info.height = defuss69_h;
    defuss69_info.stride = defuss69_row_bytes;
    defuss69_info.format = 2;
    defuss69_info.sequence = defuss69_sequence();
    defuss69_info.dirtyY = defuss69_dirty_y;
    defuss69_info.dirtyH = defuss69_dirty_h;
    defuss69_info.reserved = 0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE void *defuss69_display_info(void)
{
    return &defuss69_info;
}

static void coroutine_fn defuss69_display_frame_co(void *opaque)
{
    Error *error = NULL;
    defuss69_capture(&error);
    if (error) {
        error_free(error);
        __atomic_store_n(&defuss69_poll_state, 3, __ATOMIC_RELEASE);
    } else {
        __atomic_store_n(&defuss69_poll_state, 2, __ATOMIC_RELEASE);
    }
}

static void defuss69_display_frame_bh(void *opaque)
{
    qemu_coroutine_enter(qemu_coroutine_create(defuss69_display_frame_co, NULL));
}
#endif /* CONFIG_PIXMAN */


