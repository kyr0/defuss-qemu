/* Build-authorized TCI recipes. The JS loader pins the expanded catalog by
 * SHA-256. Never use a writable runtime-learned plan as executable input. */
typedef struct {
    uint64_t pc, cs, physical;
    uint32_t flags, cflags;
    uint16_t len, insns, prefix, body, search, jump[2], reserved;
} AotKey;
typedef struct AotBlock {
    AotKey key;
    uint8_t *bytes, *code, *search;
    unsigned disabled;
    struct AotBlock *next;
} AotBlock;
static unsigned aot_mode, aot_active, aot_stats[6];
static GByteArray *aot_output;
static GMutex aot_output_lock;
static GHashTable *aot_table;
static GArray *aot_blocks;
#define AOT_MAX_BODY 4096
#define AOT_GUARD 15
#define AOT_CAP (64u << 20)
static guint aot_hash_pc(gconstpointer p)
{
    uint64_t x = *(const uint64_t *)p;
    return (uint32_t)(x ^ (x >> 32));
}
static gboolean aot_eq_pc(gconstpointer a, gconstpointer b)
{
    return *(const uint64_t *)a == *(const uint64_t *)b;
}
static bool aot_eligible(TranslationBlock *tb, vaddr pc, void *host)
{
    return host && tb_page_addr0(tb) != -1 && tb_page_addr1(tb) == -1 &&
           wasm44_single_ctx() &&
           (tb_cflags(tb) & ~CF_CLUSTER_MASK) == CF_PCREL;
}
static bool aot_bound(const AotKey *k)
{
    return k->len && k->len <= PLAN_BYTES && k->insns && k->insns <= k->len &&
           k->body && k->body <= AOT_MAX_BODY && !(k->body & 3) &&
           k->search && k->search <= AOT_MAX_BODY &&
           k->prefix == sizeof(struct WasmTBHeader) + 4 + sizeof(void *) &&
           k->reserved == 0 &&
           (k->jump[0]==TB_JMP_OFFSET_INVALID || (k->jump[0]>=k->prefix && k->jump[0]<=k->prefix+k->body)) &&
           (k->jump[1]==TB_JMP_OFFSET_INVALID || (k->jump[1]>=k->prefix && k->jump[1]<=k->prefix+k->body));
}
static bool aot_relocate(uint8_t *body, unsigned n, uint8_t *at,
                         TranslationBlock *tb, bool capture)
{
    for (unsigned pos=0;pos<n;pos+=4) {
        uint32_t insn; memcpy(&insn,body+pos,4);
        unsigned op=insn&255;
        if (op == INDEX_op_call || op == INDEX_op_tci_call_typed ||
            op == INDEX_op_tci_movl || op == INDEX_op_goto_ptr) { return false; }
        if (op == INDEX_op_tci_brcond32 || op == INDEX_op_tci_brcond64 ||
            op == INDEX_op_tci_qemu_ld_imm32 || op == INDEX_op_tci_qemu_st_imm32) {
            if (pos+8>n) { return false; }
            pos+=4;
        } else if (op==INDEX_op_exit_tb || op==INDEX_op_goto_tb) {
            uint8_t *next=at+pos+4;
            intptr_t value=sextract32(insn,12,20);
            uintptr_t base=(uintptr_t)tcg_splitwx_to_rx(tb);
            if(capture){
                if(op==INDEX_op_exit_tb){
                    if(value){
                        uintptr_t ptr=(uintptr_t)next+value;
                        if(ptr<base || ptr>base+TB_EXIT_MASK) {return false;}
                        value=1+(ptr-base);
                    }
                }else{
                    void *ptr=(void *)((uintptr_t)next+value);
                    if(ptr==&tb->jmp_target_addr[0])value=1;
                    else if(ptr==&tb->jmp_target_addr[1])value=2;
                    else return false;
                }
            }else{
                if(op==INDEX_op_exit_tb){
                    if(value<0 || value>1+TB_EXIT_MASK)return false;
                    if(value)value=(intptr_t)(base+value-1)-(intptr_t)next;
                }else{
                    if(value!=1 && value!=2)return false;
                    value=(intptr_t)&tb->jmp_target_addr[value-1]-(intptr_t)next;
                }
                if(value!=sextract64(value,0,20))return false;
            }
            insn=deposit32(insn,12,20,value);memcpy(body+pos,&insn,4);
        }
    }
    return true;
}
EMSCRIPTEN_KEEPALIVE int defuss_aot_open(unsigned mode);
EMSCRIPTEN_KEEPALIVE int defuss_aot_open(unsigned mode)
{
    if(aot_mode || mode<1 || mode>2)return -1;
    if(mode==1){
        aot_output=g_byte_array_sized_new(1024*1024);
        g_byte_array_append(aot_output,(const uint8_t *)"DAT1",4);
    }else{
        FILE *f=fopen("/aot.input","rb");if(!f)return -1;
        char magic[4];if(fread(magic,4,1,f)!=1||memcmp(magic,"DAT1",4)){fclose(f);return -1;}
        aot_table=g_hash_table_new(aot_hash_pc,aot_eq_pc);
        aot_blocks=g_array_new(false,false,sizeof(AotBlock *));
        for(;;){
            AotKey key;
            size_t got=fread(&key,1,sizeof(key),f);
            if(!got && feof(f))break;
            if(got!=sizeof(key)||!aot_bound(&key)||ftell(f)>AOT_CAP||aot_blocks->len>=PLAN_MAX){fclose(f);return -1;}
            size_t nb=key.len+AOT_GUARD+key.body+key.search;
            AotBlock *b=g_malloc0(sizeof(*b)+nb);
            b->key=key;b->bytes=(void *)(b+1);
            b->code=b->bytes+key.len+AOT_GUARD;b->search=b->code+key.body;
            if(fread(b->bytes,1,nb,f)!=nb){g_free(b);fclose(f);return -1;}
            b->next=g_hash_table_lookup(aot_table,&key.pc);
            g_hash_table_insert(aot_table,&b->key.pc,b);g_array_append_val(aot_blocks,b);
        }
        fclose(f);
    }
    aot_mode=mode;return 0;
}
EMSCRIPTEN_KEEPALIVE void defuss_aot_activate(void);
EMSCRIPTEN_KEEPALIVE void defuss_aot_activate(void){qatomic_store_release(&aot_active,1);}
EMSCRIPTEN_KEEPALIVE uint32_t defuss_aot_stat(unsigned n);
EMSCRIPTEN_KEEPALIVE uint32_t defuss_aot_stat(unsigned n){return n<6?qatomic_read(&aot_stats[n]):0;}
EMSCRIPTEN_KEEPALIVE int defuss_aot_finish(void);
EMSCRIPTEN_KEEPALIVE int defuss_aot_finish(void)
{
    qatomic_store_release(&aot_active,0);
    g_mutex_lock(&aot_output_lock);
    GByteArray *out=g_steal_pointer(&aot_output);
    g_mutex_unlock(&aot_output_lock);
    if(!out)return 0;
    FILE *f=fopen("/aot.output","wb");
    bool good=f && fwrite(out->data,1,out->len,f)==out->len;
    if(f && fclose(f))good=false;
    g_byte_array_unref(out);
    return good?0:-1;
}
static void aot_capture(TranslationBlock *tb,vaddr pc,void *host,int search)
{
    if(!qatomic_load_acquire(&aot_active)||aot_mode!=1||!aot_eligible(tb,pc,host))return;
    qatomic_inc(&aot_stats[0]);
    struct WasmTBHeader *h=(void *)tb->tc.ptr;
    if(tcg_ctx->data_gen_ptr || !h->wasm_ptr || !tb->size || tb->size>PLAN_BYTES ||
       (pc & ~TARGET_PAGE_MASK)+tb->size+AOT_GUARD>TARGET_PAGE_SIZE)return;
    ptrdiff_t body=(uint8_t *)h->wasm_ptr-(uint8_t *)h->tci_ptr;
    if(body<4||body>AOT_MAX_BODY||search>AOT_MAX_BODY)return;
    AotKey key={.pc=pc,.cs=tb->cs_base,.physical=tb_page_addr0(tb),.flags=tb->flags,
                .cflags=tb_cflags(tb),.len=tb->size,.insns=tb->icount,
                .prefix=(uint8_t *)h->tci_ptr-(uint8_t *)h,.body=body,.search=search,
                .jump={tb->jmp_reset_offset[0],tb->jmp_reset_offset[1]}};
    uint8_t copy[AOT_MAX_BODY];memcpy(copy,h->tci_ptr,body);
    if(!aot_bound(&key)||!aot_relocate(copy,body,h->tci_ptr,tb,true))return;
    g_mutex_lock(&aot_output_lock);
    if(!aot_output || aot_output->len>AOT_CAP-sizeof(key)-PLAN_BYTES-AOT_GUARD-2*AOT_MAX_BODY ||
       qatomic_read(&aot_stats[1])>=PLAN_MAX){g_mutex_unlock(&aot_output_lock);return;}
    g_byte_array_append(aot_output,(const uint8_t *)&key,sizeof(key));
    g_byte_array_append(aot_output,host,key.len+AOT_GUARD);
    g_byte_array_append(aot_output,copy,body);
    g_byte_array_append(aot_output,(uint8_t *)tb->tc.ptr+tb->tc.size,search);
    qatomic_inc(&aot_stats[1]);g_mutex_unlock(&aot_output_lock);
}
static bool aot_replay(TranslationBlock *tb,vaddr pc,void *host,int *size,int *search)
{
    if(!qatomic_load_acquire(&aot_active)||aot_mode!=2||!aot_eligible(tb,pc,host))return false;
    qatomic_inc(&aot_stats[0]);
    AotBlock *b=g_hash_table_lookup(aot_table,&pc);
    for(;b;b=b->next){
        AotKey *k=&b->key;
        if(b->disabled||k->cs!=tb->cs_base||k->flags!=tb->flags||k->cflags!=tb_cflags(tb)||
           k->physical!=tb_page_addr0(tb)||((pc&~TARGET_PAGE_MASK)+k->len+AOT_GUARD>TARGET_PAGE_SIZE)||
           memcmp(host,b->bytes,k->len+AOT_GUARD))continue;
        uint8_t *start=tcg_splitwx_to_rw(tb->tc.ptr),*body=start+k->prefix;
        if(body+k->body+k->search>(uint8_t *)tcg_ctx->code_gen_highwater)return false;
        memset(start,0,k->prefix);struct WasmTBHeader *h=(void *)start;
        h->counter_ptr=(void *)(h+1);h->info_ptr=(void *)(h->counter_ptr+1);
        h->tci_ptr=body;h->aot_recipe=b;
        memcpy(body,b->code,k->body);
        if(!aot_relocate(body,k->body,body,tb,false))return false;
        memcpy(body+k->body,b->search,k->search);
        tb->size=k->len;tb->icount=k->insns;
        for(unsigned j=0;j<2;j++){tb->jmp_insn_offset[j]=TB_JMP_OFFSET_INVALID;tb->jmp_reset_offset[j]=k->jump[j];}
        *size=k->prefix+k->body;*search=k->search;qatomic_inc(&aot_stats[2]);qatomic_add(&aot_stats[3],k->insns);
        return true;
    }
    return false;
}
static void aot_retier(void *entry){((AotBlock *)entry)->disabled=1;qatomic_inc(&aot_stats[4]);}
