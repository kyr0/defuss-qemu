/* Observation only. No execution guard, guest-memory probe, or retained object. */
#ifdef TARGET_X86_64
#define M3CO_MAGIC UINT32_C(0x4d33434f)
#define M3CO_HEADER 64u
#define M3CO_SLOTS 16u
#define M3CO_STRIDE 128u
#define M3CO_WORDS (M3CO_HEADER + M3CO_SLOTS * M3CO_STRIDE)
static uint32_t m3co_words[M3CO_WORDS] = {
    [0]=M3CO_MAGIC,[1]=1,[2]=M3CO_WORDS,[3]=M3CO_SLOTS,
    [4]=M3CO_STRIDE,[12]=M3CO_HEADER,
};
static unsigned m3co_cached_slot;
static uintptr_t m3co_cached_code;
static uint64_t m3co_cached_generation;
static void m3co_put(uint32_t *w,unsigned i,uint64_t n)
{ w[i]=n;w[i+1]=n>>32; }
static uint64_t m3co_pair(const uint32_t *w,unsigned i)
{ return w[i]|(uint64_t)w[i+1]<<32; }
static void m3co_count(uint32_t *w)
{
    if (*w==UINT32_MAX) { m3co_words[10]|=1; }
    else { ++*w; }
}
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3co_abi(void);
EMSCRIPTEN_KEEPALIVE unsigned defuss_m3co_abi(void) { return 1; }
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3co_data(void);
EMSCRIPTEN_KEEPALIVE uintptr_t defuss_m3co_data(void)
{ return (uintptr_t)m3co_words; }
/* Original translation already validated this exact span as ordinary RAM. */
void defuss_m3co_formed(const void *opaque_env,const void *opaque_tb,
                       uint64_t pc,const void *host,unsigned bytes)
{
    if (!defuss_m3b_profile_enabled()) { return; }
    const CPUArchState *env=opaque_env;
    const TranslationBlock *tb=opaque_tb;
    m3co_cached_slot=0;m3co_cached_code=0;m3co_cached_generation=0;
    if (!tb || !host || !tb->m3b_fused || !bytes || bytes>128 ||
        bytes!=tb->m3b_bytes || !tb->m3b_b_offset || tb->m3b_b_offset>=bytes ||
        (pc&4095)+bytes>4096) { m3co_words[10]|=2;return; }
    if (m3co_words[5]>=M3CO_SLOTS) { m3co_count(&m3co_words[8]);return; }
    unsigned slot=++m3co_words[5];
    uint32_t *w=m3co_words+M3CO_HEADER+(slot-1)*M3CO_STRIDE;
    w[0]=1;w[1]=slot;m3co_put(w,2,(uintptr_t)tb);m3co_put(w,4,pc);
    m3co_put(w,6,tb_page_addr0(tb));m3co_put(w,8,tb_page_addr1(tb));
    w[10]=tb->flags;w[11]=tb_cflags(tb);w[12]=bytes;w[13]=tb->m3b_b_offset;
    m3co_put(w,22,env->cr[3]);memcpy(w+32,host,bytes);
}
static bool m3co_matches(const uint32_t *w,const struct WasmTBHeader *h)
{
    const struct m3_descriptor *d=&h->m3;
    return m3_known(d) && d->valid && d->eligibility==M3_ELIGIBLE &&
        h->m3b.fused && w[0] && m3co_pair(w,2)==d->owner &&
        m3co_pair(w,4)==d->translation_pc && m3co_pair(w,6)==d->page0 &&
        m3co_pair(w,8)==d->page1 && w[10]==d->flags && w[11]==d->cflags &&
        w[12]==h->m3b.bytes && w[13]==h->m3b.b_offset;
}
static void m3co_enter(const CPUArchState *env,const void *code,bool compiled)
{
    if (!defuss_m3b_profile_enabled()) { return; }
    const struct WasmTBHeader *h=code;
    m3co_count(&m3co_words[compiled?6:7]);
    unsigned slot=0;
    if (m3co_cached_slot && m3co_cached_code==(uintptr_t)code &&
        m3co_cached_generation==h->m3.generation) { slot=m3co_cached_slot; }
    else {
        for (unsigned i=m3co_words[5];i>0;i--) {
            const uint32_t *w=m3co_words+M3CO_HEADER+(i-1)*M3CO_STRIDE;
            if (m3co_pair(w,2)==h->m3.owner) { slot=i;break; }
        }
    }
    if (!slot) { m3co_count(&m3co_words[9]);return; }
    uint32_t *w=m3co_words+M3CO_HEADER+(slot-1)*M3CO_STRIDE;
    if (!m3co_matches(w,h) || env->eip!=m3co_pair(w,4)) {
        m3co_words[10]|=4;m3co_count(&w[30]);return;
    }
    if (w[0]==1) {
        w[0]=2;m3co_put(w,14,h->m3.generation);m3co_put(w,16,(uintptr_t)code);
        m3co_put(w,18,env->eip);m3co_put(w,24,env->cr[3]);
        m3co_put(w,64,env->cr[0]);m3co_put(w,66,env->cr[4]);
        m3co_put(w,68,env->efer);w[70]=env->hflags;w[71]=env->hflags2;
    } else if (m3co_pair(w,14)!=h->m3.generation ||
               m3co_pair(w,16)!=(uintptr_t)code ||
               m3co_pair(w,24)!=env->cr[3]) {
        m3co_words[10]|=8;m3co_count(&w[30]);return;
    }
    m3co_put(w,20,env->eip);m3co_put(w,26,env->cr[3]);
    m3co_count(&w[compiled?28:29]);
    m3co_cached_slot=slot;m3co_cached_code=(uintptr_t)code;
    m3co_cached_generation=h->m3.generation;
}
#else
void defuss_m3co_formed(const void *env,const void *tb,uint64_t pc,
                       const void *host,unsigned bytes) {}
static void m3co_enter(const CPUArchState *env,const void *code,bool compiled) {}
#endif
