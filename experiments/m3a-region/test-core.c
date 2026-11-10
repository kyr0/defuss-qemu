/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "m3-region-core.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdatomic.h>
#include <pthread.h>

static uint32_t native_load(uint32_t *word)
{ return atomic_load((_Atomic uint32_t *)word); }
static uint32_t native_cas(uint32_t *word, uint32_t old, uint32_t next)
{
    atomic_compare_exchange_strong((_Atomic uint32_t *)word, &old, next);
    return old;
}
struct configure_race { _Atomic uint32_t state; _Atomic bool go; unsigned enabled; int result; };
static void *configure_thread(void *opaque)
{
    struct configure_race *race=opaque;
    while (!atomic_load(&race->go)) { }
    race->result=m3_configure_state((uint32_t *)&race->state,race->enabled,native_load,native_cas);
    return NULL;
}
static void *lock_thread(void *opaque)
{
    struct configure_race *race=opaque;
    while (!atomic_load(&race->go)) { }
    m3_lock_configuration((uint32_t *)&race->state,native_load,native_cas);
    return NULL;
}

static struct m3_descriptor descriptor(void)
{
    return (struct m3_descriptor){.magic=M3_MAGIC,.version=M3_VERSION,.valid=1,
        .members=1,.recovery=M3_RECOVERY_TCI_SEARCH,.generation=1,.owner=4096};
}
int main(int argc, char **argv)
{
    assert(argc == 2);
    struct { uint64_t before; struct m3_descriptor d; uint64_t after; } guarded =
        {.before=UINT64_C(0xdecafbadcafedead),.d=descriptor(),.after=UINT64_C(0xfeeddead12345678)};
    assert(m3_choose(&guarded.d,1,true,false,true)==M3_SELECT);
    for (unsigned reason=1;reason<=M3_NO_WASM;reason++) {
        guarded.d.eligibility=reason;
        assert(m3_choose(&guarded.d,1,true,false,true)==M3_LEGACY);
        assert(m3_choose(&guarded.d,2,true,false,true)==M3_REDISPATCH);
        assert(m3_choose(&guarded.d,1,true,true,true)==M3_REDISPATCH);
    }
    guarded.d=descriptor();guarded.d.valid=0;
    assert(m3_choose(&guarded.d,1,true,false,false)==M3_REDISPATCH);
    guarded.d=descriptor();assert(m3_choose(&guarded.d,1,false,false,true)==M3_REDISPATCH);
    for (uint64_t generation=1;generation<10000;generation++) {
        guarded.d=descriptor();guarded.d.generation=generation;
        assert(m3_choose(&guarded.d,generation,true,false,true)==M3_SELECT);
        assert(m3_choose(&guarded.d,generation+1,true,false,true)==M3_REDISPATCH);
    }
    guarded.d=descriptor();guarded.d.generation=0;assert(!m3_known(&guarded.d));
    guarded.d=descriptor();guarded.d.members=2;assert(!m3_known(&guarded.d));
    guarded.d=descriptor();guarded.d.recovery=0;assert(!m3_known(&guarded.d));
    guarded.d=descriptor();guarded.d.owner=0;assert(!m3_known(&guarded.d));
    guarded.d=descriptor();guarded.d.magic=0;assert(m3_choose(&guarded.d,1,true,false,true)==M3_LEGACY);
    guarded.d=descriptor();guarded.d.version=2;assert(!m3_known(&guarded.d));
    assert(guarded.before==UINT64_C(0xdecafbadcafedead)&&guarded.after==UINT64_C(0xfeeddead12345678));
    assert(m3_eligibility(true,true,true,false,false,false,true)==M3_ELIGIBLE);
    assert(m3_eligibility(false,true,true,false,false,false,true)==M3_TARGET);
    assert(m3_eligibility(true,false,true,false,false,false,true)==M3_CONTEXTS);
    assert(m3_eligibility(true,true,false,false,false,false,true)==M3_MODE);
    assert(m3_eligibility(true,true,true,true,false,false,true)==M3_DEBUG);
    assert(m3_eligibility(true,true,true,false,true,false,true)==M3_TEMPORARY);
    assert(m3_eligibility(true,true,true,false,false,true,true)==M3_PLAN);
    assert(m3_eligibility(true,true,true,false,false,false,false)==M3_NO_WASM);
    bool saturated=false;
    assert(m3_saturating_add(UINT32_MAX-1,1,&saturated)==UINT32_MAX&&!saturated);
    assert(m3_saturating_add(UINT32_MAX,1,&saturated)==UINT32_MAX&&saturated);
    saturated=false;assert(m3_saturating_add(0,UINT32_MAX,&saturated)==UINT32_MAX&&!saturated);
    for (unsigned i=0;i<1000;i++) {
        struct configure_race race={.state=i&1,.go=false,.enabled=!(i&1),.result=-2};
        pthread_t configure,lock;
        assert(pthread_create(&configure,NULL,configure_thread,&race)==0);
        assert(pthread_create(&lock,NULL,lock_thread,&race)==0);
        atomic_store(&race.go,true);
        assert(pthread_join(configure,NULL)==0);assert(pthread_join(lock,NULL)==0);
        uint32_t final=atomic_load(&race.state);
        assert(final&M3_CONFIG_LOCKED);
        assert((final&M3_CONFIG_ENABLED)==(race.result==0?race.enabled:(i&1)));
        assert(m3_configure_state((uint32_t *)&race.state,!(final&1),native_load,native_cas)==-1);
        assert(atomic_load(&race.state)==final);
    }
    uint32_t words[M3_WORDS]={M3_MAGIC,M3_VERSION,1,1,0,160,sizeof(struct m3_descriptor),24,
                            M3_WATCHES,M3_WATCH_OFFSET,M3_WATCH_STRIDE,1};
    words[M3_COMPILED_ATTEMPTS]=9;words[M3_SELECTED_ENTRIES]=4;
    words[M3_FALLBACK_ENTRIES]=3;words[M3_INVALID_REDISPATCHES]=2;
    words[M3_FALLBACK_REASONS+M3_MODE]=2;words[M3_FALLBACK_REASONS+M3_METADATA]=1;
    words[M3_WATCH_OFFSET]=0x400000;words[M3_WATCH_OFFSET+2]=0x401000;
    words[M3_WATCH_OFFSET+4]=3;words[M3_WATCH_OFFSET+5]=0x400020;words[M3_WATCH_OFFSET+7]=1;
    FILE *out=fopen(argv[1],"wb");assert(out);
    assert(fwrite(words,sizeof(words),1,out)==1);assert(fclose(out)==0);
    puts("PASS: eligibility, generation/owner/invalidation decisions, metadata rejection, saturation, bounds, 1000 concurrent configure/lock races");
    return 0;
}
