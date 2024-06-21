import { CRC } from "crc-full";

const crc = new CRC("CRC8", 8, 0x07, 0xf3, 0x00, false, false);
export function computeCRC8(bytes: number[] | Buffer): number {
  if (bytes.length == 0) {
    throw new Error('Bytes cannot be empty');
  }
  return crc.compute(bytes);
}
