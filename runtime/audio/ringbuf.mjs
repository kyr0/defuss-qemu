// ringbuf.js 0.4.0 · Paul Adenot and contributors · MPL-2.0
export class RingBuffer {
    static getStorageForCapacity(capacity, type) {
        if (!type.BYTES_PER_ELEMENT) {
            throw TypeError("Pass in an ArrayBuffer subclass");
        }
        const bytes = 8 + (capacity + 1) * type.BYTES_PER_ELEMENT;
        return new SharedArrayBuffer(bytes);
    }
    _type;
    _capacity;
    buf;
    write_ptr;
    read_ptr;
    storage;
    constructor(sab, type){
        if (type.BYTES_PER_ELEMENT === undefined) {
            throw TypeError("Pass a concrete typed array class as second argument");
        }
        this._type = type;
        this._capacity = (sab.byteLength - 8) / type.BYTES_PER_ELEMENT;
        this.buf = sab;
        this.write_ptr = new Uint32Array(this.buf, 0, 1);
        this.read_ptr = new Uint32Array(this.buf, 4, 1);
        this.storage = new type(this.buf, 8, this._capacity);
    }
    type() {
        return this._type.name;
    }
    push(elements, length, offset = 0) {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        if ((wr + 1) % this._storage_capacity() === rd) {
            return 0;
        }
        const len = length !== undefined ? length : elements.length;
        const to_write = Math.min(this._available_write(rd, wr), len);
        const first_part = Math.min(this._storage_capacity() - wr, to_write);
        const second_part = to_write - first_part;
        this._copy(elements, offset, this.storage, wr, first_part);
        this._copy(elements, offset + first_part, this.storage, 0, second_part);
        Atomics.store(this.write_ptr, 0, (wr + to_write) % this._storage_capacity());
        return to_write;
    }
    writeCallback(amount, cb) {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        if ((wr + 1) % this._storage_capacity() === rd) {
            return 0;
        }
        const to_write = Math.min(this._available_write(rd, wr), amount);
        const first_part = Math.min(this._storage_capacity() - wr, to_write);
        const second_part = to_write - first_part;
        const first_part_buf = new this._type(this.storage.buffer, 8 + wr * this.storage.BYTES_PER_ELEMENT, first_part);
        const second_part_buf = new this._type(this.storage.buffer, 8 + 0, second_part);
        const written = cb(first_part_buf, second_part_buf) || to_write;
        Atomics.store(this.write_ptr, 0, (wr + written) % this._storage_capacity());
        return written;
    }
    writeCallbackWithOffset(amount, cb) {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        if ((wr + 1) % this._storage_capacity() === rd) {
            return 0;
        }
        const to_write = Math.min(this._available_write(rd, wr), amount);
        const first_part = Math.min(this._storage_capacity() - wr, to_write);
        const second_part = to_write - first_part;
        const written = cb(this.storage, wr, first_part, 0, second_part) || to_write;
        Atomics.store(this.write_ptr, 0, (wr + written) % this._storage_capacity());
        return written;
    }
    pop(elements, length, offset = 0) {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        if (wr === rd) {
            return 0;
        }
        const len = length !== undefined ? length : elements.length;
        const to_read = Math.min(this._available_read(rd, wr), len);
        const first_part = Math.min(this._storage_capacity() - rd, to_read);
        const second_part = to_read - first_part;
        this._copy(this.storage, rd, elements, offset, first_part);
        this._copy(this.storage, 0, elements, offset + first_part, second_part);
        Atomics.store(this.read_ptr, 0, (rd + to_read) % this._storage_capacity());
        return to_read;
    }
    empty() {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        return wr === rd;
    }
    full() {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        return (wr + 1) % this._storage_capacity() === rd;
    }
    capacity() {
        return this._capacity - 1;
    }
    availableRead() {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        return this._available_read(rd, wr);
    }
    available_read() {
        return this.availableRead();
    }
    availableWrite() {
        const rd = Atomics.load(this.read_ptr, 0);
        const wr = Atomics.load(this.write_ptr, 0);
        return this._available_write(rd, wr);
    }
    available_write() {
        return this.availableWrite();
    }
    _available_read(rd, wr) {
        return (wr + this._storage_capacity() - rd) % this._storage_capacity();
    }
    _available_write(rd, wr) {
        return this.capacity() - this._available_read(rd, wr);
    }
    _storage_capacity() {
        return this._capacity;
    }
    _copy(input, offset_input, output, offset_output, size) {
        if (!size) {
            return;
        }
        if (offset_input === 0 && offset_output + input.length <= this._storage_capacity() && input.length === size) {
            output.set(input, offset_output);
            return;
        }
        let i = 0;
        const unrollFactor = 16;
        for(; i <= size - unrollFactor; i += unrollFactor){
            output[offset_output + i] = input[offset_input + i];
            output[offset_output + i + 1] = input[offset_input + i + 1];
            output[offset_output + i + 2] = input[offset_input + i + 2];
            output[offset_output + i + 3] = input[offset_input + i + 3];
            output[offset_output + i + 4] = input[offset_input + i + 4];
            output[offset_output + i + 5] = input[offset_input + i + 5];
            output[offset_output + i + 6] = input[offset_input + i + 6];
            output[offset_output + i + 7] = input[offset_input + i + 7];
            output[offset_output + i + 8] = input[offset_input + i + 8];
            output[offset_output + i + 9] = input[offset_input + i + 9];
            output[offset_output + i + 10] = input[offset_input + i + 10];
            output[offset_output + i + 11] = input[offset_input + i + 11];
            output[offset_output + i + 12] = input[offset_input + i + 12];
            output[offset_output + i + 13] = input[offset_input + i + 13];
            output[offset_output + i + 14] = input[offset_input + i + 14];
            output[offset_output + i + 15] = input[offset_input + i + 15];
        }
        for(; i < size; i++){
            output[offset_output + i] = input[offset_input + i];
        }
    }
}
