import { Transform, TransformCallback } from "stream";
import Debug from "debug";
import { computeCRC8 } from "./utils";

function formatByte(byte: number): string {
  return "0x" + byte.toString(16).padStart(2, "0");
}

Debug.formatters.h = (v: number[] | Buffer) => {
  return Buffer.from(v).toString("hex");
};
Debug.formatters.x = formatByte;
const debug = Debug("hcp");

const PACKET_OVERHEAD = 3;
const MAX_PACKET_LENGTH = 15 + PACKET_OVERHEAD;
enum PKT_HEADER {
  ADDRESS,
  LENGTH,
  __SIZE,
}

export class HCPPacket extends Uint8Array {
  // do not override constructor as it's overloaded and used by some methods (subarray)
  // use a factory instead
  static fromBuffer(buffer: number[] | Uint8Array, validate: boolean = true): HCPPacket {
    // sanity checks
    if (buffer.length < PACKET_OVERHEAD + 1) {
      throw new Error(`HCPPacket cannot be shorter than ${PACKET_OVERHEAD + 1} bytes`);
    } else if (buffer.length > MAX_PACKET_LENGTH) {
      throw new Error(`HCPPacket cannot be longer than ${MAX_PACKET_LENGTH} bytes`);
    }

    const packet = new HCPPacket(buffer);
    if (validate === true) packet._validate();
    return packet;
  }

  get address(): number {
    return this[PKT_HEADER.ADDRESS];
  }

  get lengthNibble(): number {
    return this[PKT_HEADER.LENGTH] & 0x0f;
  }

  get counterNibble(): number {
    return (this[PKT_HEADER.LENGTH] & 0xf0) >> 4;
  }

  get header(): Uint8Array {
    return this.subarray(0, PKT_HEADER.__SIZE);
  }

  get payload(): Uint8Array {
    return this.subarray(PKT_HEADER.__SIZE);
  }

  get crc(): number {
    return this[this.length - 1];
  }

  private _validate(): boolean {
    /**
     * Ensure consistency of HCP packet length and CRC
     */
    // check crc value
    const expectedCRC = this.computeCRC();
    if (expectedCRC != this.crc) {
      throw new Error(
        `Invalid CRC (got ${formatByte(this.crc)} expected ${formatByte(expectedCRC)})`,
      );
    }
    // check length nibble is good
    const parseLength = this.lengthNibble + PACKET_OVERHEAD;
    if (parseLength != this.length) {
      throw new Error(`Invalid total length (got ${parseLength} expected ${this.length})`);
    }

    return true;
  }

  public equals(other: Uint8Array | number[]): boolean {
    return this.length === other.length && this.every((value, index) => value === other[index]);
  }

  public computeCRC(): number {
    return computeCRC8(this.subarray(0, this.length - 1));
  }

  public isValid(): boolean {
    try {
      return this._validate();
    } catch {
      return false;
    }
  }

  public hex(): string {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
  }

  static fromData(
    addressByte: number,
    counterNibble: number,
    payload: number[] | Buffer,
    crc?: number,
    validate: boolean = crc === undefined ? false : true,
  ): HCPPacket {
    let tmpCRC: number = -1;
    // create packet buffer from its data
    if (addressByte > 0xff) throw new Error("address byte cannot exceed 255");
    if (counterNibble > 0xf) throw new Error("counter nibble cannot exceed 15");
    if (crc !== undefined) {
      if (crc > 0xff) throw new Error("crc cannot exceed 255");
      tmpCRC = crc;
    }

    const lengthByte = (counterNibble << 4) + payload.length;
    const buffer = [addressByte, lengthByte, ...payload, tmpCRC];
    // compute crc if undefined
    if (crc === undefined) {
      buffer[buffer.length - 1] = computeCRC8(buffer.slice(0, buffer.length - 1));
    }

    return HCPPacket.fromBuffer(buffer, validate);
  }
}

export class SimpleHCPPacketParser extends Transform {
  /**
   * Iterates over read bytes one by one.
   * Drops all bytes if packet is invalid
   * So it can miss valid packets in case of glitches
   */
  buffer: Buffer;
  started: boolean;
  offset!: number;
  packetLength!: number;

  constructor() {
    super({ objectMode: true });

    this.buffer = Buffer.alloc(MAX_PACKET_LENGTH);
    this.started = false;
    this._resetPacket();
  }

  _resetPacket() {
    // offset when several chunks are needed to get a full packet
    this.offset = -1;
    // total packetLength computed from LENGTH byte
    this.packetLength = 0;
    this.buffer.fill(0);
  }

  _parseCurrentByte(byte: number): boolean {
    switch (this.offset) {
      case PKT_HEADER.ADDRESS:
        // TODO: limit the possibilites for 1st byte ?
        debug("address %x", byte);
        break;
      case PKT_HEADER.LENGTH:
        // parse packet length and message counter values
        this.packetLength = (byte & 0x0f) + PACKET_OVERHEAD;
        debug(
          "parsed packet length %d ((%x & 0x0f) + %d)",
          this.packetLength,
          byte,
          PACKET_OVERHEAD,
        );
        break;
      // const message_counter = (byte & 0xf0) >> 4;
      case this.packetLength - 1: {
        // packet complete
        const packetCRC = computeCRC8(this.buffer.subarray(0, this.offset));
        debug("packet complete: %h CRC %x", this.buffer.subarray(0, this.offset + 1), packetCRC);
        if (packetCRC == byte) {
          // packet valid
          this.push(HCPPacket.fromBuffer(this.buffer.subarray(0, this.offset + 1), false));
        } else {
          debug("CRC error, expected %x", byte);
        }
        return false;
      }
      case MAX_PACKET_LENGTH:
        // TODO: to delete, cannot happen?
        // packet too long, restart packet
        debug("packet too long, restart packet");
        return false;
      default:
        debug("processed byte %x", byte);
    }
    return true;
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, cb: TransformCallback) {
    /**
     * Parses valid HCP packets from a stream of bytes
     * Pushes HCPPacket instances
     */
    debug("reading chunk: %h", chunk);
    for (const byte of chunk) {
      // TODO: if (chunk.length > 5) do sthg ?
      if (this.started === false) {
        // TODO: additional condition to restart packet?
        this._resetPacket();
        this.started = true;
      }
      if (this.started === true) {
        this.offset++;
        this.buffer[this.offset] = byte;
        debug("offset", this.offset);
        this.started = this._parseCurrentByte(byte);
        // TODO: migh as well break than restart a packet on next byte if false ?
      }
    }

    cb();
  }
}

export class BatchHCPPacketParser extends Transform {
  /**
   * Iterates over each chunk of read bytes to find valid packet as early as possible
   * Might create false positive packets in case of CRC collision
   */

  buffer: Buffer;
  offset: number;
  tested: boolean[];
  minUntestedIdx: number;

  constructor() {
    super({ objectMode: true });
    this.tested = new Array(MAX_PACKET_LENGTH).fill(false);
    // queue buffer with enough space to hold full packet data for tested array
    this.buffer = Buffer.alloc(2 * MAX_PACKET_LENGTH - PKT_HEADER.__SIZE).fill(0);
    this.offset = 0;
    this.minUntestedIdx = 0;
  }

  _resetTestedArray(): void {
    this.tested.fill(false);
    this.minUntestedIdx = 0;
  }

  _pop_buffer(nbElements: number): void {
    this.buffer.copyWithin(0, nbElements);
    this.offset -= nbElements;
  }

  _testPacket(offset: number, length: number): boolean {
    if (length < PACKET_OVERHEAD + 1) {
      // packet cannot be empty
      return false;
    }
    const testBuffer = this.buffer.subarray(offset, offset + length - 1);
    const packetCRC = computeCRC8(testBuffer);
    debug(
      "computed CRC %x expected CRC %x for buffer %h",
      packetCRC,
      this.buffer[offset + length - 1],
      testBuffer,
    );
    return packetCRC == this.buffer[offset + length - 1] ? true : false;
  }

  _testPacketRange(fromByteIdx: number, untilByteIdx: number): number {
    const maxTestIdx: number = Math.min(untilByteIdx - PACKET_OVERHEAD - 1, this.tested.length - 1);
    let parsedLength: number;

    for (let i = fromByteIdx; i <= maxTestIdx; i++) {
      if (this.tested[i] === true) {
        // already tested, skip
        continue;
      }
      // check candidate packet starting at byte i
      parsedLength = (this.buffer[i + PKT_HEADER.LENGTH] & 0x0f) + PACKET_OVERHEAD;
      debug("packet parsed length %d from byte %d", parsedLength, i);
      if (i + parsedLength > untilByteIdx) {
        continue;
      }
      // if enough data available test it
      if (this._testPacket(i, parsedLength) === true) {
        // push packet and rewind
        debug("pushing valid packet %h", this.buffer.subarray(i, i + parsedLength));
        this.push(HCPPacket.fromBuffer(this.buffer.subarray(i, i + parsedLength), false));
        this._resetTestedArray();
        return i + parsedLength;
      } else {
        this.tested[i] = true;
        if (i == this.tested.length - 1) {
          // if reached the end of tested array, clear it and rewind
          debug("test array complete, rewinding");
          this._resetTestedArray();
          return this.tested.length;
        } else if (i == this.minUntestedIdx) {
          // increment the marker
          this.minUntestedIdx++;
        }
      }
    }
    return 0;
  }

  _transform(bytes: Buffer, _encoding: BufferEncoding, cb: TransformCallback) {
    /**
     * Parses valid HCP packets from a stream of bytes
     * Pushes HCPPacket instances
     */
    debug("reading chunk: %h", bytes);
    let bytesOffset: number = 0;
    let remainingBytes: number = bytes.length;
    let chunkSize: number;
    let bytesToPop: number;
    let bkpOffset: number = -1;
    // while we consume bytes
    while (bkpOffset != this.offset) {
      // fill queue
      debug("minUntestedIdx", this.minUntestedIdx);
      chunkSize = Math.min(this.buffer.length - this.offset, remainingBytes);
      if (chunkSize > 0) {
        this.buffer.fill(
          bytes.subarray(bytesOffset, bytesOffset + chunkSize),
          this.offset,
          this.offset + chunkSize,
        );
        this.offset += chunkSize;
        bytesOffset += chunkSize;
        remainingBytes = bytes.length - bytesOffset;
      }
      debug("buffer", this.buffer);
      debug("offset %d remaining %d bytes to read", this.offset, remainingBytes);
      // test candidate packets from minUntestedIdx
      bytesToPop = this._testPacketRange(this.minUntestedIdx, this.offset);
      // save backup offset and pop buffers to rewind
      bkpOffset = this.offset;
      debug("%d bytes to pop after test, bkpOffset %d", bytesToPop, bkpOffset);
      if (bytesToPop > 0) {
        this._pop_buffer(bytesToPop);
      }
    }

    cb();
  }
}
