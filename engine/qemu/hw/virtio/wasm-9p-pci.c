/* SPDX-License-Identifier: GPL-2.0-or-later
 * Virtio 9P transport for the Emscripten in-memory export. */
#include "qemu/osdep.h"
#include "qemu/iov.h"
#include "qemu/module.h"
#include "migration/vmstate.h"
#include "hw/virtio/virtio.h"
#include "hw/virtio/virtio-pci.h"
#include "hw/virtio/virtio-access.h"
#include "standard-headers/linux/virtio_9p.h"
#include <emscripten.h>

#define TYPE_WASM9P "wasm-9p-device"
OBJECT_DECLARE_SIMPLE_TYPE(Wasm9P, WASM9P)
enum { P9_LIMIT = 65536 };
struct Wasm9P {
    VirtIODevice parent;
    VirtQueue *vq;
    uint8_t *in, *out;
};
static void handle_p9(VirtIODevice *vdev, VirtQueue *vq)
{
    Wasm9P *s = WASM9P(vdev);
    VirtQueueElement *el;
    while ((el = virtqueue_pop(vq, sizeof(*el)))) {
        size_t n = iov_size(el->out_sg, el->out_num);
        size_t cap = MIN((size_t)P9_LIMIT, iov_size(el->in_sg, el->in_num));
        int reply = 0;
        if (n >= 7 && n <= P9_LIMIT && cap >= 7) {
            iov_to_buf(el->out_sg, el->out_num, 0, s->in, n);
            reply = MAIN_THREAD_EM_ASM_INT({
                const fn = Module["handle9P"];
                if (!fn) return 0;
                const inOff = Number($0);
                const outOff = Number($2);
                return fn(HEAPU8.subarray(inOff, inOff + Number($1)),
                          HEAPU8.subarray(outOff, outOff + Number($3)));
            }, (uintptr_t)s->in, (int)n, (uintptr_t)s->out, (int)cap);
            if (reply > 0 && reply <= cap) {
                iov_from_buf(el->in_sg, el->in_num, 0, s->out, reply);
            } else {
                reply = 0;
            }
        }
        virtqueue_push(vq, el, reply);
        g_free(el);
    }
    virtio_notify(vdev, vq);
}
static void p9_config(VirtIODevice *vdev, uint8_t *cfg)
{
    virtio_stw_p(vdev, cfg, 9);
    memcpy(cfg + 2, "hostshare", 9);
}
static uint64_t p9_features(VirtIODevice *vdev, uint64_t f, Error **errp)
{
    virtio_add_feature(&f, VIRTIO_9P_MOUNT_TAG);
    return f;
}
static void p9_realize(DeviceState *dev, Error **errp)
{
    Wasm9P *s = WASM9P(dev);
    virtio_init(VIRTIO_DEVICE(dev), VIRTIO_ID_9P, 11);
    s->in = g_malloc(P9_LIMIT); s->out = g_malloc(P9_LIMIT);
    s->vq = virtio_add_queue(VIRTIO_DEVICE(dev), 64, handle_p9);
}
static void p9_unrealize(DeviceState *dev)
{
    Wasm9P *s = WASM9P(dev);
    virtio_del_queue(VIRTIO_DEVICE(dev), 0);
    virtio_cleanup(VIRTIO_DEVICE(dev));
    g_free(s->in); g_free(s->out);
}
/* Transport state only. Host export/fid state is session-local.
 * Only quiescent, pre-mount demo checkpoints are portable. */
static const VMStateDescription vmstate_web9p = {
    .name = "wasm-virtio-9p", .version_id = 1, .minimum_version_id = 1,
    .fields = (const VMStateField[]) { VMSTATE_VIRTIO_DEVICE, VMSTATE_END_OF_LIST() },
};
static void p9_class(ObjectClass *oc, const void *data)
{
    VirtioDeviceClass *k = VIRTIO_DEVICE_CLASS(oc);
    DEVICE_CLASS(oc)->vmsd = &vmstate_web9p;
    k->realize = p9_realize; k->unrealize = p9_unrealize;
    k->get_config = p9_config; k->get_features = p9_features;
}
static const TypeInfo p9_info = {
    .name = TYPE_WASM9P, .parent = TYPE_VIRTIO_DEVICE,
    .instance_size = sizeof(Wasm9P), .class_init = p9_class,
};
typedef struct Wasm9PPCI { VirtIOPCIProxy parent; Wasm9P dev; } Wasm9PPCI;
static void p9_pci_realize(VirtIOPCIProxy *pci, Error **errp)
{
    Wasm9PPCI *p = (Wasm9PPCI *)pci;
    qdev_realize(DEVICE(&p->dev), BUS(&pci->bus), errp);
}
static void p9_pci_class(ObjectClass *oc, const void *data)
{
    PCIDeviceClass *k = PCI_DEVICE_CLASS(oc);
    VIRTIO_PCI_CLASS(oc)->realize = p9_pci_realize;
    k->vendor_id = PCI_VENDOR_ID_REDHAT_QUMRANET;
    k->device_id = PCI_DEVICE_ID_VIRTIO_9P;
    k->revision = VIRTIO_PCI_ABI_VERSION;
    k->class_id = PCI_CLASS_STORAGE_OTHER;
}
static void p9_pci_init(Object *obj)
{
    Wasm9PPCI *p = (Wasm9PPCI *)obj;
    virtio_instance_init_common(obj, &p->dev, sizeof(p->dev), TYPE_WASM9P);
}
static const VirtioPCIDeviceTypeInfo p9_pci_info = {
    .base_name="wasm-9p-pci-base", .generic_name="wasm-9p-pci",
    .instance_size=sizeof(Wasm9PPCI), .instance_init=p9_pci_init, .class_init=p9_pci_class,
};
static void register_p9(void)
{
    type_register_static(&p9_info);
    virtio_pci_types_register(&p9_pci_info);
}
type_init(register_p9)
