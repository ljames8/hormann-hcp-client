import { EventEmitter } from "events";
import { SerialPort, SerialPortOpenOptions } from "serialport";
import Debug from "debug";
import { hex } from "./utils";
import { HCPPacket, BatchHCPPacketParser, PacketFilterParams } from "./parser";
import { AutoDetectTypes } from "@serialport/bindings-cpp";

const debug = Debug("hcp:client");
const trace = Debug("hcp:serial");

export const DEFAULT_BAUDRATE = 19200;
const MIN_RESPONSE_DELAY_MS = 3;

const UAP1_ADDR = 0x28;
const UAP1_TYPE = 0x14;

enum ADDRESS {
  BROADCAST = 0x00,
  MASTER = 0x80,
  SLAVE = UAP1_ADDR,
}

enum COMMAND {
  SLAVE_SCAN = 0x01,
  SLAVE_STATUS_REQUEST = 0x20,
  SLAVE_STATUS_RESPONSE = 0x29,
}

export enum STATUS_RESPONSE_BYTE0_BITFIELD {
  OPEN = 0,
  CLOSE = 1,
  TOGGLE_LIGHT = 2,
  VENTING = 3,
}

enum STATUS_RESPONSE_BYTE1_VALUE {
  /* different values for byte #1 of slave status response */
  // will emergency stop if this byte is not 0x10
  DEFAULT = 0x10,
  STOP = 0x00,
}

export enum DIRECTION {
  OPENING = 0,
  CLOSING = 1,
}

export enum BROADCAST_STATUS_BYTE0_BITFIELD {
  DOOR_CLOSED = 0,
  DOOR_OPENED = 1,
  EXT_RELAY_ON = 2,
  LIGHT_RELAY_ON = 3,
  ERROR_ACTIVE = 4,
  DOOR_DIRECTION = 5,
  DOOR_MOVING = 6,
  DOOR_VENTING = 7,
}

export interface ResponsePayload {
  payload: number[];
  counter?: number;
  resolve: (value: HCPPacket) => void;
  reject?: (reason?: string) => void;
}

export class SerialHCPClient extends EventEmitter {
  private parser: BatchHCPPacketParser;
  port: SerialPort;
  nextMessageCounter: number;
  sendQueue: ResponsePayload[];

  constructor(
    { path, baudRate, ...rest }: SerialPortOpenOptions<AutoDetectTypes>,
    parserOptions?: PacketFilterParams,
  ) {
    super();

    this.port = new SerialPort({ path, baudRate, ...rest });
    this.port.on("open", this.onOpen.bind(this));
    this.port.on("close", this.onClose.bind(this));
    this.port.on("error", this.onError.bind(this));

    this.parser = new BatchHCPPacketParser(parserOptions);
    this.parser.on("data", this.onNewPacket.bind(this));

    this.nextMessageCounter = 1;
    this.sendQueue = [];
    this.port.pipe(this.parser);
  }

  private onOpen() {
    trace("Serial port opened");
    this.emit("open");
  }

  private onClose() {
    trace("Serial port closed");
    this.emit("close");
  }

  private onError(error: Error) {
    console.error("Serial port error", error);
    this.emit("error", error);
  }

  private onNewPacket(packet: HCPPacket) {
    // new HCP packet was read and parsed from serial port
    const timestamp = Date.now();
    let response: ResponsePayload | null = null;
    try {
      response = this.processMessage(packet);
    } catch (error) {
      this.emit("error", error);
    }
    if (response !== null) {
      const packet = HCPPacket.fromData(ADDRESS.MASTER, response.counter!, response.payload);
      debug("responding with %h", packet);
      this.sendPacket(packet, MIN_RESPONSE_DELAY_MS - Date.now() + timestamp)
        .then(() => {
          response.resolve(packet);
        })
        .catch((reason) => {
          response.reject?.("TX error: " + reason);
        });
    }
  }

  static extractBitfield(byte: number): boolean[] {
    const bits: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      bits[i] = ((1 << i) & byte) != 0;
    }
    return bits;
  }

  static createSlaveStatusPayload(
    flags: STATUS_RESPONSE_BYTE0_BITFIELD[],
    emergencyStop: boolean = false,
  ): number[] {
    let byte0 = 0x00;
    for (const flag of flags) {
      byte0 |= 1 << flag;
    }
    const byte1 =
      emergencyStop === true
        ? STATUS_RESPONSE_BYTE1_VALUE.STOP
        : STATUS_RESPONSE_BYTE1_VALUE.DEFAULT;
    return [COMMAND.SLAVE_STATUS_RESPONSE, byte0, byte1];
  }

  static getNextCounter(counter: number): number {
    return (counter + 1) % 16;
  }

  close() {
    if (this.port.isOpen) {
      this.port.close();
    }
  }

  async sendPacket(packet: HCPPacket, delay?: number): Promise<void> {
    if (delay !== undefined && delay > 0) {
      trace(`sleeping for ${delay}ms before sending`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return new Promise((resolve, reject) => {
      this.port.write(packet, (error) => {
        if (error) {
          return reject(error);
        } else {
          return resolve();
        }
      });
    });
  }

  processMessage(packet: HCPPacket): ResponsePayload | null {
    const nextCounter = SerialHCPClient.getNextCounter(packet.counterNibble);

    if (packet.counterNibble != this.nextMessageCounter) {
      if (packet.address == ADDRESS.BROADCAST) {
        // only warn and force sync next counter
        debug(
          "warning: syncing broadcast counter, " +
            `got ${packet.counterNibble} expected ${this.nextMessageCounter}`,
        );
      } else {
        // error for incorrect counter for other cases
        throw new Error(
          `Invalid message counter, got ${packet.counterNibble} ` +
            `expected ${this.nextMessageCounter}`,
        );
      }
    }
    this.nextMessageCounter = nextCounter;

    switch (packet.address) {
      case ADDRESS.BROADCAST: {
        this.emit("data", SerialHCPClient.unpackBroadcast(packet));
        break;
      }
      case ADDRESS.SLAVE: {
        this.nextMessageCounter = nextCounter;
        const response = this.processSlaveCommand(packet);
        // set response counter
        if (response.counter === undefined) response.counter = this.nextMessageCounter;
        // increment counter again for next message to be read
        this.nextMessageCounter = SerialHCPClient.getNextCounter(response.counter);
        if (response.reject === undefined)
          response.reject = (reason) => {
            throw new Error(reason);
          };
        return response;
      }
      default:
      // ignoring message
    }
    return null;
  }

  static unpackBroadcast(packet: HCPPacket): Uint8Array {
    /**
     * Unpack both broadcast status packet bytes
     */
    const payload = packet.payload;
    if (payload.length != 2)
      throw new Error(`Payload ${hex(payload)} of length ${payload.length}, expecting 2`);
    return payload;
  }

  processSlaveCommand(packet: HCPPacket): ResponsePayload {
    const payload = packet.payload;

    switch (payload[0]) {
      case COMMAND.SLAVE_SCAN: {
        debug("received slave scan query %h", packet);
        // sanity check
        if (payload.length != 2 || payload[1] != ADDRESS.MASTER) {
          throw new Error(`Unexpected payload ${hex(payload)} for slave scan packet`);
        }
        // reply
        return {
          payload: [UAP1_TYPE, UAP1_ADDR],
          resolve: (p) => {
            this.emit("init", p);
          },
          reject: () => {
            throw new Error("could not respond to scan");
          },
        };
      }
      case COMMAND.SLAVE_STATUS_REQUEST: {
        debug("got slave status request %h", packet);
        // sanity check
        if (payload.length != 1) {
          throw new Error(`Unexpected payload length for slave status request (${payload.length})`);
        }

        if (this.sendQueue.length > 0) {
          // pop queue
          return this.sendQueue.shift()!;
        } else {
          // queue empty, default response
          return {
            payload: SerialHCPClient.createSlaveStatusPayload([]),
            resolve: () => {},
            reject: () => {
              throw new Error("could not respond to slave status request");
            },
          };
        }
      }
      default:
        throw new Error(
          `Unknown slave command code ${packet.payload[0]} in packet ${packet.hex()}`,
        );
    }
  }

  pushCommand(
    flags: STATUS_RESPONSE_BYTE0_BITFIELD[],
    emergencyStop: boolean = false,
  ): Promise<HCPPacket> {
    /** with HCP, to send a command to the door driver (master)
     * you have to wait for the next slave status request from the master.
     * So push the command and await the promise to be resolved to confirm it was sent
     */
    const payload = SerialHCPClient.createSlaveStatusPayload(flags, emergencyStop);
    return new Promise<HCPPacket>((resolve, reject) => {
      this.sendQueue.push({ payload, resolve, reject });
    });
  }
}
