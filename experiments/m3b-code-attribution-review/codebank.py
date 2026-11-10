"""Separate Python decoder for exact formation bytes and per-generation attempts."""
def need(ok,message):
    if not ok:raise ValueError(message)
FORMATION=('slot','owner','translationPC','page0','page1','flags','cflags','bytes','bOffset','formationCr3','bytesHex')
ENTRY=('generation','code','firstPC','firstCr3','cr0','cr4','efer','hflags','hflags2')
def decode(w,profile,initial=False):
    need(type(w) is list and len(w)==2112 and all(type(n) is int and 0<=n<2**32 for n in w),'Exact uint32 bank')
    need(w[:5]==[0x4d33434f,1,2112,16,128] and w[12]==64,'ABI/layout')
    need(not any(w[8:12]+w[13:64]),'Overflow/unmatched/error/reserved header')
    need(w[5]<=16 and w[5:8]==[profile[k] for k in ('formed','compiledEntries','tciEntries')],'Original profile reconciliation')
    records=[]
    for slot in range(16):
        r=w[64+128*slot:64+128*(slot+1)]
        if slot>=w[5]:need(not any(r),'Inactive slot');continue
        need(r[0] in (1,2) and r[1]==slot+1 and not any(r[30:32]+r[72:]),'Slot state/error/reserved')
        pair=lambda at:hex(r[at]+r[at+1]*2**32)
        record={key:pair(at) for key,at in [('owner',2),('translationPC',4),('page0',6),('page1',8),('generation',14),('code',16),('firstPC',18),('lastPC',20),('formationCr3',22),('firstCr3',24),('lastCr3',26),('cr0',64),('cr4',66),('efer',68)]}
        record.update({key:r[at] for key,at in [('slot',1),('flags',10),('cflags',11),('bytes',12),('bOffset',13),('compiled',28),('tci',29),('hflags',70),('hflags2',71)]})
        record['status']='formed' if r[0]==1 else 'entered'
        pc=int(record['translationPC'],16);physical=int(record['page0'],16)
        need(int(record['owner'],16)>0 and 65536<=pc<2**47,'Owner/user PC')
        need(record['page1']==hex(2**64-1) and 2**20<=physical<512*2**20 and pc%4096==physical%4096,'Single RAM page identity')
        need(0<r[13]<r[12]<=128 and pc%4096+r[12]<=4096,'Bounded complete formation span')
        data=b''.join(n.to_bytes(4,'little') for n in r[32:64]);need(not any(data[r[12]:]),'Code byte tail');record['bytesHex']=data[:r[12]].hex()
        if r[0]==1:need(not any(r[14:22]+r[24:30]+r[64:72]),'Unentered identity')
        else:
            need(int(record['generation'],16)>0 and int(record['code'],16)>0 and r[28]+r[29]>0,'Bound entered generation')
            need(record['firstPC']==record['lastPC']==record['translationPC'] and record['firstCr3']==record['lastCr3'],'Actual entry PC/address space consistency')
        records.append(record)
    need(sum(r['compiled'] for r in records)==w[6] and sum(r['tci'] for r in records)==w[7],'Per-generation attempts reconcile')
    if initial:need(not any(w[5:12]),'Empty startup')
    return {'formed':w[5],'compiled':w[6],'tci':w[7],'records':records}
def difference(a,b):
    need(all(b[k]>=a[k] for k in ('formed','compiled','tci')),'Cumulative counts')
    records=[]
    for i,r in enumerate(b['records']):
        old=a['records'][i] if i<len(a['records']) else None
        if old:
            need(all(old[k]==r[k] for k in FORMATION),'Immutable formation')
            if old['status']=='entered':need(r['status']=='entered' and all(old[k]==r[k] for k in ENTRY),'Immutable entry binding')
        row=dict(r)
        for k in ('compiled','tci'):
            row[k]-=old[k] if old else 0;need(row[k]>=0,'Per-generation monotonicity')
        records.append(row)
    result={k:b[k]-a[k] for k in ('compiled','tci')};result['records']=records
    need(all(sum(r[k] for r in records)==result[k] for k in ('compiled','tci')),'Phase partition')
    return result
def reconstruct(rows,phases):
    decoded=[]
    for index,row in enumerate(rows):
        profile=dict(zip(('formed','compiledEntries','tciEntries'),[row['m3bRaw'][17],row['m3bRaw'][20],row['m3bRaw'][21]]))
        current=decode(row['codeRaw'],profile,index==0)
        if decoded:difference(decoded[-1],current)
        decoded.append(current)
    gates={row['gate']['seq']:i for i,row in enumerate(rows) if row['kind']=='gate'}
    for phase in phases:phase['code']=difference(decoded[gates[phase['startSeq']]],decoded[gates[phase['endSeq']]])
    return decoded[-1]
