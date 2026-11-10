"""Independent arithmetic implementation of the observation-only admission ABI."""
STAGES=['translations','suppressed','noHost','formRejected','ramRejected','predecodeCalls']
SHAPES=['accepted','limit','truncated','opcode','prefix','memory','control','closure']
REASONS=['profile','contexts','planOrAot','mode','blockedHflags','noPcrel','blockedCflags','noRamPage']
SCOPE='Cumulative diagnostic translation-admission observations. Rejection reasons overlap; last bytes are one descriptive sample, not application-PC attribution or dynamic execution counts.'
def need(ok,message):
    if not ok:raise ValueError(message)
def decode(w,trials,initial=False):
    need(len(w)==128 and all(type(n) is int and 0<=n<=0xffffffff for n in w),'128 exact uint32 words')
    need(w[:4]==[0x4d334241,1,128,0],'Header/saturation')
    reserved=[*range(4,8),11,14,15,22,23,*range(26,32),*range(40,48),*range(56,64),71,*range(74,96)]
    need(not any(w[i] for i in reserved) and w[24]==0 and w[25]==0,'Reserved/fault counters')
    need(w[16]==sum(w[17:22]),'Terminal admission stage partition')
    need(w[21]==sum(w[32:40]) and w[32]==trials,'Decoder result/trial partition')
    need(all(n<=w[19] for n in w[48:56]) and sum(w[48:56])>=w[19],'Overlapping rejection reasons')
    pair=lambda i:hex(w[i]+(w[i+1]<<32))
    rejected=None;sample=None
    if w[19]:
        need(0<w[8]<256,'Reason bitmap');rejected={'reasons':w[8],'flags':w[9],'cflags':w[10],'pc':pair(12)}
    else:need(not any(w[8:11]+w[12:14]),'Absent rejection sample')
    if w[21]:
        need(0<w[68]<=128 and 0<w[69]<=512 and w[70]<8 and w[32+w[70]]>0,'Last decoder metadata')
        data=b''.join(n.to_bytes(4,'little') for n in w[96:]);need(not any(data[w[68]:]),'Zero sample tail')
        sample={'pc':pair(64),'flags':w[66],'cflags':w[67],'span':w[68],'maxInstructions':w[69],'result':SHAPES[w[70]],'ramAddress':pair(72),'bytesHex':data[:w[68]].hex()}
    else:need(not any(w[64:]),'Absent decoder sample')
    if initial:need(not any(w[4:]),'Startup counters')
    return {'counters':dict(zip(STAGES,w[16:22])),'decoder':dict(zip(SHAPES,w[32:40])),'rejections':dict(zip(REASONS,w[48:56])),'lastRejection':rejected,'lastDecode':sample,'scope':SCOPE}
def differences(a,b):
    need(a.keys()==b.keys(),'Counter field mismatch');out={}
    for key,value in a.items():
        need(type(value) is int and type(b[key]) is int and 0<=value<=b[key],'Counter reset/wrap');out[key]=b[key]-value
    return out
def reconstruct(rows,phases):
    observed=[]
    for i,row in enumerate(rows):
        current=decode(row['admissionRaw'],row['m3bRaw'][16],i==0)
        if observed:
            for family in ['counters','decoder','rejections']:differences(observed[-1][family],current[family])
        observed.append(current)
    gates={row['gate']['seq']:i for i,row in enumerate(rows) if row['kind']=='gate'}
    for phase in phases:
        a,b=[observed[gates[phase[key]]] for key in ['startSeq','endSeq']]
        phase['admission']={key:differences(a[key],b[key]) for key in ['counters','decoder','rejections']}
    return observed[-1]
