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
    debug("computeCRC length %d", this.length);
    debug("computeCRC subarray %h", this.subarray(0, this.length - 1));
    debug("computeCRC array %h", this);
    debug("computeCRC array %h", this.subarray(3, 5));
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

