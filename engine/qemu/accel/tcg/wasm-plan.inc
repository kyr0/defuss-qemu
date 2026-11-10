/* Translation-plan hints contain guest bytes and context only. QEMU decodes
 * every block from live guest memory and retains all its access checks. */
#define PLAN_MAX 80000
#define PLAN_BYTES 128
typedef struct {
    uint64_t pc, cs;
    uint32_t flags, cflags;
    uint16_t size, count;
    uint8_t bytes[PLAN_BYTES];
} PlanKey;
typedef struct {
    PlanKey key;
    uint8_t promoted, prior, visited, _pad;
} PlanEntry;
static PlanEntry *plan_rows;
static GHashTable *plan_table;
static GMutex plan_lock;
static unsigned plan_count, plan_mode, plan_stats[8];
__thread bool wasm44_defer;
__thread uint32_t wasm44_entry, wasm44_warm;
static guint plan_hash(gconstpointer key)
{
    const PlanKey *k = key;
    return (uint32_t)(k->pc ^ (k->pc >> 29) ^ k->flags ^ k->cflags);
}
static gboolean plan_equal(gconstpointer a, gconstpointer b)
{
    const PlanKey *x = a, *y = b;
    return x->pc == y->pc && x->cs == y->cs && x->flags == y->flags &&
           x->cflags == y->cflags && x->size == y->size &&
           x->count == y->count && memcmp(x->bytes, y->bytes, x->size) == 0;
}
static int wasm44_init_plan(unsigned mode)
{
    /* Called in preRun, before workers exist. Mode 1 learns, 2 uses hints,
     * 3 uses promotion hints without suppressing the cold Wasm tier. */
    if (plan_table || mode < 1 || mode > 3) { return -1; }
    plan_rows = g_try_new0(PlanEntry, PLAN_MAX);
    if (!plan_rows) { return -1; }
    plan_table = g_hash_table_new(plan_hash, plan_equal);
    if (mode >= 2) {
        FILE *f = fopen("/plan.input", "rb");
        uint32_t header[2];
        if (!f || fread(header, sizeof(header), 1, f) != 1 ||
            header[0] != 0x314e4c50 || header[1] > PLAN_MAX) {
            if (f) { fclose(f); }
            return -1;
        }
        for (unsigned i = 0; i < header[1]; i++) {
            PlanEntry *e = &plan_rows[i];
            if (fread(e, sizeof(*e), 1, f) != 1 || !e->key.size ||
                e->key.size > PLAN_BYTES || e->promoted > 1 ||
                g_hash_table_lookup(plan_table, &e->key)) {
                fclose(f);return -1;
            }
            e->prior = 1; e->visited = 0;
            g_hash_table_insert(plan_table, &e->key, GUINT_TO_POINTER(i + 1));
            plan_count++;
        }
        int trailing = fgetc(f);
        fclose(f);
        if (trailing != EOF) { return -1; }
    }
    return 0;
}
EMSCRIPTEN_KEEPALIVE int defuss_plan_open(unsigned mode);
EMSCRIPTEN_KEEPALIVE int defuss_plan_open(unsigned mode)
{
    if (plan_table) { return -1; }
    int result=wasm44_init_plan(mode);
    if(result<0){
        if(plan_table)g_hash_table_destroy(plan_table);
        plan_table=NULL;g_clear_pointer(&plan_rows,g_free);plan_count=0;
    }
    return result;
}
EMSCRIPTEN_KEEPALIVE void defuss_plan_activate(unsigned mode);
EMSCRIPTEN_KEEPALIVE void defuss_plan_activate(unsigned mode)
{
    if (plan_table && mode >= 1 && mode <= 3) {
        qatomic_store_release(&plan_mode, mode);
    }
}
EMSCRIPTEN_KEEPALIVE uint32_t defuss_plan_stat(unsigned n);
EMSCRIPTEN_KEEPALIVE uint32_t defuss_plan_stat(unsigned n)
{
    return n < ARRAY_SIZE(plan_stats) ? qatomic_read(&plan_stats[n]) : 0;
}
EMSCRIPTEN_KEEPALIVE int defuss_plan_write(void);
EMSCRIPTEN_KEEPALIVE int defuss_plan_write(void)
{
    if (!plan_table) { return -1; }
    g_mutex_lock(&plan_lock);
    FILE *f = fopen("/plan.output","wb");
    uint32_t header[2] = { 0x314e4c50, plan_count };
    bool good = f && fwrite(header,sizeof(header),1,f)==1;
    for (unsigned i=0; good && i<plan_count; i++) {
        PlanEntry row = plan_rows[i];row.promoted=qatomic_read(&plan_rows[i].promoted);
        good = fwrite(&row,sizeof(row),1,f)==1;
    }
    if (f && fclose(f)) { good=false; }
    g_mutex_unlock(&plan_lock);
    return good ? 0 : -1;
}
static void wasm44_identify(TranslationBlock *tb, vaddr pc, void *host)
{
    unsigned mode=qatomic_load_acquire(&plan_mode);
    wasm44_defer=false;wasm44_entry=0;wasm44_warm=0;
    if (!mode) { return; }
    qatomic_inc(&plan_stats[0]);
    if (!host || tb_page_addr0(tb)==-1 || tb_page_addr1(tb)!=-1 ||
        tb->size==0 || tb->size>PLAN_BYTES ||
        (pc & ~TARGET_PAGE_MASK) + tb->size > TARGET_PAGE_SIZE) { return; }
    PlanKey key={ .pc=pc, .cs=tb->cs_base, .flags=tb->flags,
                  .cflags=tb_cflags(tb), .size=tb->size, .count=tb->icount };
    memcpy(key.bytes,host,key.size);
    g_mutex_lock(&plan_lock);
    unsigned id=GPOINTER_TO_UINT(g_hash_table_lookup(plan_table,&key));
    if (!id && plan_count<PLAN_MAX) {
        id=++plan_count;plan_rows[id-1].key=key;
        g_hash_table_insert(plan_table,&plan_rows[id-1].key,GUINT_TO_POINTER(id));
    }
    if (id) {
        PlanEntry *e=&plan_rows[id-1];
        if (e->prior) {
            qatomic_inc(&plan_stats[1]);
            if (!e->visited) { qatomic_inc(&plan_stats[2]); }
            if (qatomic_read(&e->promoted)) { wasm44_warm=1;qatomic_inc(&plan_stats[3]); }
            else if (mode==2) { wasm44_defer=true;qatomic_inc(&plan_stats[4]); }
        }
        e->visited=1;wasm44_entry=id;
    }
    g_mutex_unlock(&plan_lock);
}
void wasm44_promoted(unsigned id)
{
    if (id) {
        g_mutex_lock(&plan_lock);
        qatomic_set(&plan_rows[id-1].promoted,1);
        g_mutex_unlock(&plan_lock);
    }
}
#include "wasm-aot.inc"

uintptr_t wasm44_retier(CPUArchState *env, void *code)
{
    struct WasmTBHeader *header=code;
    TranslationBlock *tb=tcg_tb_lookup((uintptr_t)code);
    /* This is a TB header, before its first guest operation. The standard
     * requested-exit path restores the guest PC and checks pending events. */
    g_assert(tb && tb->tc.ptr==code && (header->plan_id || header->aot_recipe));
    if(header->aot_recipe)aot_retier(header->aot_recipe);
    wasm44_promoted(header->plan_id);
    qatomic_inc(&plan_stats[5]);
    tb_phys_invalidate(tb,-1);
    cpu_exit(env_cpu(env));
    return (uintptr_t)tcg_splitwx_to_rx(tb) | TB_EXIT_REQUESTED;
}
