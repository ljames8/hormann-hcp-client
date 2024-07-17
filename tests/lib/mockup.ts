import { Transform, TransformCallback } from 'stream';

export class IntervalReadable extends Transform {
  /**
   * Mockup class to emulate packets being emitted at regular intervals
   */
  private chunkSize: number;
  private interval: number;

  constructor({ interval, chunkSize = 0 }: { interval: number, chunkSize?: number }) {
    super();
    this.chunkSize = chunkSize;
    this.interval = interval;
  }

  async _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
    // process chunk
    this.emitPacket(chunk);
    await new Promise((resolve) => { setTimeout(resolve, this.interval) });
    // sleep and signal chunk was processed
    callback();
  }

  private emitPacket(packet: Buffer) { 
    if (this.chunkSize <= 0) {
      this.push(packet);
    } else {
      // emit the packet in multiple continuous chunks
      for (let i = 0; i <= Math.floor(packet.length / this.chunkSize); i++) {
        this.push(packet.subarray(i * this.chunkSize, (i + 1) * this.chunkSize));
      }
    }
  }

  put(packets: ArrayBufferLike[]) {
    // batch write the list of packets
    packets.map((p) => this.write(p));
  }
}
