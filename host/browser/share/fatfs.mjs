export var FatFsIoctl = /*#__PURE__*/ function(FatFsIoctl) {
    FatFsIoctl[FatFsIoctl["CTRL_SYNC"] = 0] = "CTRL_SYNC";
    FatFsIoctl[FatFsIoctl["GET_SECTOR_COUNT"] = 1] = "GET_SECTOR_COUNT";
    FatFsIoctl[FatFsIoctl["GET_SECTOR_SIZE"] = 2] = "GET_SECTOR_SIZE";
    FatFsIoctl[FatFsIoctl["GET_BLOCK_SIZE"] = 3] = "GET_BLOCK_SIZE";
    FatFsIoctl[FatFsIoctl["CTRL_TRIM"] = 4] = "CTRL_TRIM";
    return FatFsIoctl;
}({});
export var FatFsFormat = /*#__PURE__*/ function(FatFsFormat) {
    FatFsFormat[FatFsFormat["FAT"] = 1] = "FAT";
    FatFsFormat[FatFsFormat["FAT32"] = 2] = "FAT32";
    FatFsFormat[FatFsFormat["EXFAT"] = 4] = "EXFAT";
    FatFsFormat[FatFsFormat["ANY"] = 7] = "ANY";
    FatFsFormat[FatFsFormat["SFD"] = 8] = "SFD";
    return FatFsFormat;
}({});
export var FatFsResult = /*#__PURE__*/ function(FatFsResult) {
    FatFsResult[FatFsResult["OK"] = 0] = "OK";
    FatFsResult[FatFsResult["DISK_ERR"] = 1] = "DISK_ERR";
    FatFsResult[FatFsResult["INT_ERR"] = 2] = "INT_ERR";
    FatFsResult[FatFsResult["NOT_READY"] = 3] = "NOT_READY";
    FatFsResult[FatFsResult["NO_FILE"] = 4] = "NO_FILE";
    FatFsResult[FatFsResult["NO_PATH"] = 5] = "NO_PATH";
    FatFsResult[FatFsResult["INVALID_NAME"] = 6] = "INVALID_NAME";
    FatFsResult[FatFsResult["DENIED"] = 7] = "DENIED";
    FatFsResult[FatFsResult["EXIST"] = 8] = "EXIST";
    FatFsResult[FatFsResult["INVALID_OBJECT"] = 9] = "INVALID_OBJECT";
    FatFsResult[FatFsResult["WRITE_PROTECTED"] = 10] = "WRITE_PROTECTED";
    FatFsResult[FatFsResult["INVALID_DRIVE"] = 11] = "INVALID_DRIVE";
    FatFsResult[FatFsResult["NOT_ENABLED"] = 12] = "NOT_ENABLED";
    FatFsResult[FatFsResult["NO_FILESYSTEM"] = 13] = "NO_FILESYSTEM";
    FatFsResult[FatFsResult["MKFS_ABORTED"] = 14] = "MKFS_ABORTED";
    FatFsResult[FatFsResult["TIMEOUT"] = 15] = "TIMEOUT";
    FatFsResult[FatFsResult["LOCKED"] = 16] = "LOCKED";
    FatFsResult[FatFsResult["NOT_ENOUGH_CORE"] = 17] = "NOT_ENOUGH_CORE";
    FatFsResult[FatFsResult["TOO_MANY_OPEN_FILES"] = 18] = "TOO_MANY_OPEN_FILES";
    FatFsResult[FatFsResult["INVALID_PARAMETER"] = 19] = "INVALID_PARAMETER";
    return FatFsResult;
}({});
export var FatFsAttrib = /*#__PURE__*/ function(FatFsAttrib) {
    FatFsAttrib[FatFsAttrib["RDO"] = 1] = "RDO";
    FatFsAttrib[FatFsAttrib["HID"] = 2] = "HID";
    FatFsAttrib[FatFsAttrib["SYS"] = 4] = "SYS";
    FatFsAttrib[FatFsAttrib["DIR"] = 16] = "DIR";
    FatFsAttrib[FatFsAttrib["ARC"] = 32] = "ARC";
    return FatFsAttrib;
}({});
export var FatFsMode = /*#__PURE__*/ function(FatFsMode) {
    FatFsMode[FatFsMode["READ"] = 1] = "READ";
    FatFsMode[FatFsMode["WRITE"] = 2] = "WRITE";
    FatFsMode[FatFsMode["OPEN_EXISTING"] = 0] = "OPEN_EXISTING";
    FatFsMode[FatFsMode["CREATE_NEW"] = 4] = "CREATE_NEW";
    FatFsMode[FatFsMode["CREATE_ALWAYS"] = 8] = "CREATE_ALWAYS";
    FatFsMode[FatFsMode["OPEN_ALWAYS"] = 16] = "OPEN_ALWAYS";
    FatFsMode[FatFsMode["OPEN_APPEND"] = 48] = "OPEN_APPEND";
    return FatFsMode;
}({});
const FF_MAX_SS = 512;
const DEFAULT_SECTOR_SIZE = 512;
const UINT32_SIZE = 0x100000000;
async function getWasm(importObject, options) {
    if (options?.exfat) throw Error('This distribution uses FAT16');
    const url = new URL('./ff.wasm', import.meta.url);
    const data = url.protocol === 'file:' ? await (await import('node:fs/promises')).readFile(url) : await (await fetch(url)).arrayBuffer();
    return WebAssembly.instantiate(data, importObject);
}
function throwIfError(actionName, action, onError) {
    const result = action();
    if (result !== 0) {
        onError?.();
        throw new FatFsError(actionName, result);
    }
}
function splitUint64(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Expected a non-negative safe integer");
    return [
        value >>> 0,
        Math.floor(value / UINT32_SIZE)
    ];
}
function getUint64Number(view, offset) {
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    const value = low + high * UINT32_SIZE;
    if (!Number.isSafeInteger(value)) throw new RangeError("64-bit value exceeds Number.MAX_SAFE_INTEGER");
    return value;
}
function setUint64Number(view, offset, value) {
    const [low, high] = splitUint64(value);
    view.setUint32(offset, low, true);
    view.setUint32(offset + 4, high, true);
}
function createImportObject(memory, disk, sectorSize, lbaSize) {
    const ss = (sectorSize ?? DEFAULT_SECTOR_SIZE) | 0;
    const sectorCount = Math.floor(disk.byteLength / ss);
    const isValidPhysicalDrive = (pdrv)=>pdrv === 0;
    const toSectorNumber = (low, high)=>(low >>> 0) + (high >>> 0) * UINT32_SIZE;
    return {
        env: {
            memory: memory,
            disk_initialize: (pdrv)=>{
                return isValidPhysicalDrive(pdrv) ? 0 : 1;
            },
            disk_status: (pdrv)=>{
                return isValidPhysicalDrive(pdrv) ? 0 : 1;
            },
            ffw_disk_read: (pdrv, buff, sectorLow, sectorHigh, count)=>{
                if (!isValidPhysicalDrive(pdrv)) return 4;
                const sectorNumber = toSectorNumber(sectorLow, sectorHigh);
                const src = disk.subarray(sectorNumber * ss, (sectorNumber + count) * ss);
                const heap = new Uint8Array(memory.buffer);
                heap.set(src, buff);
                return 0;
            },
            ffw_disk_write: (pdrv, buff, sectorLow, sectorHigh, count)=>{
                if (!isValidPhysicalDrive(pdrv)) return 4;
                const sectorNumber = toSectorNumber(sectorLow, sectorHigh);
                const heap = new Uint8Array(memory.buffer);
                const src = heap.subarray(buff, buff + count * ss);
                disk.set(src, sectorNumber * ss);
                return 0;
            },
            disk_ioctl: (pdrv, cmd, buff)=>{
                if (!isValidPhysicalDrive(pdrv)) return 4;
                const view = new DataView(memory.buffer);
                switch(cmd){
                    case 0:
                        break;
                    case 2:
                        view.setUint16(buff, ss, true);
                        break;
                    case 1:
                        if (lbaSize === 8) setUint64Number(view, buff, sectorCount);
                        else view.setUint32(buff, sectorCount, true);
                        break;
                    case 3:
                        view.setUint32(buff, 1, true);
                        break;
                    case 4:
                        break;
                    default:
                        break;
                }
                return 0;
            },
            get_fattime: ()=>{
                const date = new Date();
                const year = (date.getFullYear() - 1980) % 128;
                const month = date.getMonth() + 1;
                const day = date.getDay();
                const hour = date.getHours();
                const minute = date.getMinutes();
                const second = date.getSeconds() >> 1;
                return year << 25 | month << 21 | day << 16 | hour << 11 | minute << 5 | second;
            }
        }
    };
}
class FatFsObject {
    #fatFsPtr;
    #context;
    constructor(fatFsPtr, context){
        this.#fatFsPtr = fatFsPtr;
        this.#context = context;
    }
    get ptr() {
        return this.#fatFsPtr;
    }
    get cSize() {
        return this.#context.view.getUint16(this.#fatFsPtr + this.#context.layout.offsetFatfsCsize, true);
    }
}
class FatFsMemoryContext {
    #memory;
    #exports;
    #layout;
    constructor(memory, exports, layout){
        this.#memory = memory;
        this.#exports = exports;
        this.#layout = layout;
    }
    get heap() {
        return new Uint8Array(this.#memory.buffer);
    }
    get view() {
        return new DataView(this.#memory.buffer);
    }
    get layout() {
        return this.#layout;
    }
    allocString(text) {
        if (typeof text === 'undefined' || text === null) return 0;
        const textBytes = new TextEncoder().encode(text);
        const textPtr = this.alloc(textBytes.length + 1);
        const textArray = this.heap.subarray(textPtr, textPtr + textBytes.length + 1);
        textArray.set(textBytes);
        textArray[textArray.length - 1] = 0;
        return textPtr;
    }
    alloc(size) {
        return this.#exports.malloc(size);
    }
    free(ptr) {
        this.#exports.free(ptr);
    }
    decodeString(buffer, size) {
        const ptrArray = this.heap.subarray(buffer, buffer + size);
        const zeroIndex = ptrArray.indexOf(0);
        const ptrTrimmed = zeroIndex >= 0 ? ptrArray.subarray(0, zeroIndex) : ptrArray;
        return new TextDecoder().decode(ptrTrimmed);
    }
    enterScope(callback) {
        const resources = [];
        const scope = {
            alloc: (size)=>{
                const ptr = this.alloc(size);
                resources.unshift(ptr);
                return ptr;
            },
            allocString: (text)=>{
                const ptr = this.allocString(text);
                resources.unshift(ptr);
                return ptr;
            }
        };
        try {
            return callback(scope);
        } finally{
            for (const ptr of resources){
                this.free(ptr);
            }
        }
    }
}
export class FatFsFileInfo {
    size;
    date;
    attrib;
    name;
    constructor(size, date, attrib, name){
        this.size = size;
        this.date = date;
        this.attrib = attrib;
        this.name = name;
    }
    static fromFilInfo(data, layout) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const size = layout.lbaSize === 8 ? getUint64Number(view, 0) : view.getUint32(0, true);
        const encodedDate = view.getUint16(layout.lbaSize, true);
        const year = 1980 + ((encodedDate & 0xFE00) >> 9);
        const month = ((encodedDate & 0x01E0) >> 5) - 1;
        const day = encodedDate & 0x001F;
        const encodedTime = view.getUint16(layout.lbaSize + 2, true);
        const hour = (encodedTime & 0xF800) >> 11;
        const minute = (encodedTime & 0x07E0) >> 5;
        const second = (encodedTime & 0x001F) * 2;
        const date = new Date(year, month, day, hour, minute, second);
        const attrib = data[layout.offsetFilinfoFattrib];
        const nameArray = data.subarray(layout.offsetFilinfoFname, layout.sizeFilinfo);
        const zeroIndex = nameArray.indexOf(0);
        const nameTrimmed = zeroIndex >= 0 ? nameArray.subarray(0, zeroIndex) : nameArray;
        const name = new TextDecoder().decode(nameTrimmed);
        return new FatFsFileInfo(size, date, attrib, name);
    }
    get isReadOnly() {
        return !!(this.attrib & 1);
    }
    get isDirectory() {
        return !!(this.attrib & 16);
    }
    get isHidden() {
        return !!(this.attrib & 2);
    }
    get isArchive() {
        return !!(this.attrib & 32);
    }
    get isSystem() {
        return !!(this.attrib & 4);
    }
}
export class FatFsError extends Error {
    result;
    constructor(action, errorCode){
        const message = `Error ${action}: ${FatFsResult[errorCode]} (${errorCode})`;
        super(message);
        Object.setPrototypeOf(this, FatFsError.prototype);
        this.result = errorCode;
    }
}
export class FatFsFile {
    #filePtr;
    #exports;
    #context;
    constructor(filePtr, exports, context){
        this.#filePtr = filePtr;
        this.#exports = exports;
        this.#context = context;
    }
    get fp() {
        return this.#filePtr;
    }
    read(buff, btr) {
        const f_read = this.#exports.f_read;
        const filePtr = this.#filePtr;
        const bytesToRead = btr ?? buff.length;
        return this.#context.enterScope((scope)=>{
            const buffPtr = scope.alloc(bytesToRead);
            const brPtr = scope.alloc(4);
            throwIfError("reading file", ()=>f_read(filePtr, buffPtr, bytesToRead, brPtr));
            const bytesRead = this.#context.view.getUint32(brPtr, true);
            buff.set(this.#context.heap.subarray(buffPtr, buffPtr + bytesRead));
            return bytesRead;
        });
    }
    write(buff, btw) {
        return this.#context.enterScope((scope)=>{
            const bytesToWrite = btw ?? buff.length;
            const buffPtr = scope.alloc(bytesToWrite);
            const bwPtr = scope.alloc(4);
            this.#context.heap.subarray(buffPtr, buffPtr + bytesToWrite).set(buff);
            throwIfError("writing file", ()=>this.#exports.f_write(this.#filePtr, buffPtr, bytesToWrite, bwPtr));
            return this.#context.view.getUint32(bwPtr, true);
        });
    }
    close() {
        try {
            throwIfError("closing file", ()=>this.#exports.f_close(this.#filePtr));
        } finally{
            this.#exports.free(this.#filePtr);
        }
    }
    sync() {
        throwIfError("syncing disk", ()=>this.#exports.f_sync(this.#filePtr));
    }
    lseek(ofs) {
        const [ofsLow, ofsHigh] = splitUint64(ofs);
        throwIfError("seeking", ()=>this.#exports.ffw_f_lseek(this.#filePtr, ofsLow, ofsHigh));
    }
    rewind() {
        this.lseek(0);
    }
    truncate() {
        throwIfError("truncating file", ()=>this.#exports.f_truncate(this.#filePtr));
    }
    expand(fsz, opt) {
        const [fszLow, fszHigh] = splitUint64(fsz);
        throwIfError("expanding file", ()=>this.#exports.ffw_f_expand(this.#filePtr, fszLow, fszHigh, opt));
    }
    tell() {
        return this.#exports.ffw_f_tell_low(this.#filePtr) + this.#exports.ffw_f_tell_high(this.#filePtr) * UINT32_SIZE;
    }
    eof(fp) {
        return this.tell() >= this.size() ? 1 : 0;
    }
    size() {
        return this.#exports.ffw_f_size_low(this.#filePtr) + this.#exports.ffw_f_size_high(this.#filePtr) * UINT32_SIZE;
    }
    error(fp) {
        return 0;
    }
}
export class FatFsDir {
    #dirPtr;
    #exports;
    #context;
    constructor(dirPtr, exports, context){
        this.#dirPtr = dirPtr;
        this.#exports = exports;
        this.#context = context;
    }
    get dp() {
        return this.#dirPtr;
    }
    close() {
        throwIfError("closing directory", ()=>this.#exports.f_closedir(this.#dirPtr));
        this.#context.free(this.#dirPtr);
    }
    read() {
        return this.#context.enterScope((scope)=>{
            const fno = scope.alloc(this.#context.layout.sizeFilinfo);
            throwIfError("reading directory", ()=>this.#exports.f_readdir(this.#dirPtr, fno));
            const fnoData = this.#context.heap.subarray(fno, fno + this.#context.layout.sizeFilinfo);
            return FatFsFileInfo.fromFilInfo(fnoData, this.#context.layout);
        });
    }
    rewind() {
        throwIfError("rewinding directory", ()=>this.#exports.f_readdir(this.#dirPtr, 0));
    }
    findNext() {
        return this.#context.enterScope((scope)=>{
            const fno = scope.alloc(this.#context.layout.sizeFilinfo);
            throwIfError("searching directory for next match", ()=>this.#exports.f_findnext(this.#dirPtr, fno));
            const fnoData = this.#context.heap.subarray(fno, fno + this.#context.layout.sizeFilinfo);
            return FatFsFileInfo.fromFilInfo(fnoData, this.#context.layout);
        });
    }
    *[Symbol.iterator]() {
        let fileInfo;
        this.rewind();
        while((fileInfo = this.read()).name !== '')yield fileInfo;
    }
}
const FATFS_DISK_OPTION_DEFAULTS = {
    exfat: false,
    sectorSize: DEFAULT_SECTOR_SIZE
};
export class FatFsDisk {
    #context;
    #exports;
    static async create(disk, options) {
        const memory = new WebAssembly.Memory({
            initial: 8
        });
        const validOptions = {
            ...FATFS_DISK_OPTION_DEFAULTS,
            ...options ?? {}
        };
        const importObject = createImportObject(memory, disk, validOptions.sectorSize, validOptions.exfat ? 8 : 4);
        const source = await getWasm(importObject, validOptions);
        const exports = source.instance.exports;
        const layout = {
            sizeFatfs: exports.sizeof_FATFS(),
            sizeFil: exports.sizeof_FIL(),
            sizeDir: exports.sizeof_DIR(),
            sizeFilinfo: exports.sizeof_FILINFO(),
            offsetFatfsCsize: exports.offset_FATFS_csize(),
            offsetFilinfoFattrib: exports.offset_FILINFO_fattrib(),
            offsetFilinfoAltname: exports.offset_FILINFO_altname(),
            offsetFilinfoFname: exports.offset_FILINFO_fname(),
            tcharSize: exports.sizeof_TCHAR(),
            lbaSize: validOptions.exfat ? 8 : 4
        };
        const context = new FatFsMemoryContext(memory, exports, layout);
        exports.ffw_reset_vol_to_part();
        return new FatFsDisk(context, exports);
    }
    constructor(context, exports){
        this.#context = context;
        this.#exports = exports;
    }
    mkfs(opt) {
        this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(opt?.path ?? '');
            let optPtr = 0;
            if (typeof opt !== 'undefined' && opt !== null) {
                optPtr = scope.alloc(16);
                const view = this.#context.view;
                view.setUint8(optPtr, opt?.fmt ?? 7);
                view.setUint8(optPtr + 1, opt?.nFat ?? 0);
                view.setUint32(optPtr + 4, opt?.align ?? 0, true);
                view.setUint32(optPtr + 8, opt?.nRoot ?? 0, true);
                view.setUint32(optPtr + 12, opt?.auSize ?? 0, true);
            }
            const workAreaPtr = scope.alloc(4096);
            const format = ()=>this.#exports.f_mkfs(pathPtr, optPtr, workAreaPtr, 4096);
            let result = format();
            if (result === 14 && (opt?.path ?? '') === '') {
                this.#exports.ffw_set_vol_to_part(0, 0, 1);
                result = format();
                if (result !== 0) this.#exports.ffw_reset_vol_to_part();
            }
            if (result !== 0) throw new FatFsError("formatting disk", result);
        });
    }
    mount(path, opt) {
        const malloc = (size)=>this.#context.alloc(size);
        return this.#context.enterScope((scope)=>{
            const fsPtr = malloc(this.#context.layout.sizeFatfs);
            for(let i = 0; i < this.#context.layout.sizeFatfs; i++)this.#context.heap[fsPtr + i] = 0;
            const pathPtr = scope.allocString(path ?? '');
            throwIfError("mounting workspace", ()=>this.#exports.f_mount(fsPtr, pathPtr, opt ?? 0), ()=>this.#context.free(fsPtr));
            return new FatFsObject(fsPtr, this.#context);
        });
    }
    unmount(path) {
        return this.#context.enterScope((scope)=>{
            try {
                const pathPtr = scope.allocString(path ?? '');
                throwIfError("unmounting workspace", ()=>this.#exports.f_mount(0, pathPtr, 0));
            } finally{}
        });
    }
    open(path, mode) {
        return this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            const fpPtr = this.#context.alloc(this.#context.layout.sizeFil);
            throwIfError("opening file", ()=>this.#exports.f_open(fpPtr, pathPtr, mode), ()=>this.#context.free(fpPtr));
            return new FatFsFile(fpPtr, this.#exports, this.#context);
        });
    }
    session(action, path = '') {
        this.mount(path);
        try {
            return action();
        } finally{
            this.unmount(path);
        }
    }
    readFile(path) {
        const info = this.stat(path);
        const result = new Uint8Array(info.size);
        const file = this.open(path, 1);
        try {
            file.read(result);
            return result;
        } finally{
            file.close();
        }
    }
    writeFile(path, contents) {
        const file = this.open(path, 2 | 16);
        try {
            file.write(contents);
        } finally{
            file.close();
        }
    }
    openDir(path) {
        return this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            const dpPtr = this.#context.alloc(this.#context.layout.sizeDir);
            throwIfError("opening directory", ()=>this.#exports.f_opendir(dpPtr, pathPtr), ()=>this.#context.free(dpPtr));
            return new FatFsDir(dpPtr, this.#exports, this.#context);
        });
    }
    findFirst(path, pattern) {
        return this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            const patternPtr = scope.allocString(pattern);
            const fno = scope.alloc(this.#context.layout.sizeFilinfo);
            const dpPtr = this.#context.alloc(this.#context.layout.sizeDir);
            throwIfError("searching directory", ()=>this.#exports.f_findfirst(dpPtr, fno, pathPtr, patternPtr));
            const fnoData = this.#context.heap.subarray(fno, fno + this.#context.layout.sizeFilinfo);
            return [
                new FatFsDir(dpPtr, this.#exports, this.#context),
                FatFsFileInfo.fromFilInfo(fnoData, this.#context.layout)
            ];
        });
    }
    *find(path, pattern) {
        let dir;
        let fileInfo;
        [dir, fileInfo] = this.findFirst(path, pattern);
        while(fileInfo.name !== ''){
            yield fileInfo;
            fileInfo = dir.findNext();
        }
    }
    stat(path) {
        return this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            const fno = scope.alloc(this.#context.layout.sizeFilinfo);
            throwIfError("getting file information", ()=>this.#exports.f_stat(pathPtr, fno));
            const fnoData = this.#context.heap.subarray(fno, fno + this.#context.layout.sizeFilinfo);
            return FatFsFileInfo.fromFilInfo(fnoData, this.#context.layout);
        });
    }
    unlink(path) {
        this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            throwIfError("deleting file or directory", ()=>this.#exports.f_unlink(pathPtr));
        });
    }
    rename(oldName, newName) {
        this.#context.enterScope((scope)=>{
            const oldNamePtr = scope.allocString(oldName);
            const newNamePtr = scope.allocString(newName);
            throwIfError("renaming file or directory", ()=>this.#exports.f_rename(oldNamePtr, newNamePtr));
        });
    }
    chmod(path, attr, mask) {
        this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            throwIfError("changing file or directory permissions", ()=>this.#exports.f_chmod(pathPtr, attr, mask));
        });
    }
    utime(path, time) {
        this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            const fno = scope.alloc(this.#context.layout.sizeFilinfo);
            const year = time.getFullYear() - 1980 & 0x7F;
            const month = time.getMonth() + 1;
            const day = time.getDay();
            const encodedDate = year << 9 | month << 5 | day;
            this.#context.view.setUint16(fno + this.#context.layout.lbaSize, encodedDate, true);
            const hour = time.getHours();
            const minute = time.getMinutes();
            const seconds = time.getSeconds() >>> 1;
            const encodedTime = hour << 11 | minute << 5 | seconds;
            this.#context.view.setUint16(fno + this.#context.layout.lbaSize + 2, encodedTime, true);
            throwIfError("changing timestamp of file or directory", ()=>this.#exports.f_utime(pathPtr, fno));
        });
    }
    mkdir(path) {
        const f_mkdir = this.#exports.f_mkdir;
        this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            throwIfError("creating directory", ()=>this.#exports.f_mkdir(pathPtr));
        });
    }
    chdir(path) {
        this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            throwIfError("changing current directory", ()=>this.#exports.f_chdir(pathPtr));
        });
    }
    chdrive(path) {
        this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path);
            throwIfError("changing current drive", ()=>this.#exports.f_chdrive(pathPtr));
        });
    }
    getcwd() {
        return this.#context.enterScope((scope)=>{
            const buffer = scope.alloc(260);
            throwIfError("getting current directory", ()=>this.#exports.f_getcwd(buffer, 260));
            return this.#context.decodeString(buffer, 260);
        });
    }
    getFree(path) {
        return this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path ?? '');
            const nclst = scope.alloc(4);
            const fatfsPtr = scope.alloc(4);
            throwIfError("getting free space on drive", ()=>this.#exports.f_getfree(pathPtr, nclst, fatfsPtr));
            return [
                this.#context.view.getUint32(nclst, true),
                new FatFsObject(fatfsPtr, this.#context)
            ];
        });
    }
    getLabel(path) {
        return this.#context.enterScope((scope)=>{
            const pathPtr = scope.allocString(path ?? '');
            const label = scope.alloc(13);
            this.#context.heap[label + 12] = 0;
            const vsn = scope.alloc(4);
            throwIfError("getting volume label", ()=>this.#exports.f_getlabel(pathPtr, label, vsn));
            return [
                this.#context.decodeString(label, 13),
                this.#context.view.getUint32(vsn, true)
            ];
        });
    }
    setLabel(label) {
        this.#context.enterScope((scope)=>{
            const labelPtr = scope.allocString(label);
            throwIfError("setting volume label", ()=>this.#exports.f_setlabel(labelPtr));
        });
    }
    fdisk(ptbl) {
        this.#context.enterScope((scope)=>{
            const workAreaPtr = scope.alloc(FF_MAX_SS);
            const entries = Math.min(ptbl.length, 4);
            const ptblLowPtr = scope.alloc(5 * 4);
            const ptblHighPtr = scope.alloc(5 * 4);
            for(let i = 0; i < 5; i++){
                this.#context.view.setUint32(ptblLowPtr + i * 4, 0, true);
                this.#context.view.setUint32(ptblHighPtr + i * 4, 0, true);
            }
            for(let i = 0; i < entries; i++){
                const [low, high] = splitUint64(ptbl[i]);
                this.#context.view.setUint32(ptblLowPtr + i * 4, low, true);
                this.#context.view.setUint32(ptblHighPtr + i * 4, high, true);
            }
            throwIfError("partitioning disk", ()=>this.#exports.ffw_f_fdisk(0, ptblLowPtr, ptblHighPtr, workAreaPtr));
            for(let i = 0; i < 4; i++){
                if (i < entries && ptbl[i] > 0) this.#exports.ffw_set_vol_to_part(i, 0, i + 1);
                else this.#exports.ffw_set_vol_to_part(i, 1, 0);
            }
        });
    }
}
