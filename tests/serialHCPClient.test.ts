import { MockBinding, MockPortBinding } from "@serialport/binding-mock";
import { SerialPortMock } from "serialport";

import {
  SerialHCPClient,
  BROADCAST_STATUS_BYTE0_BITFIELD,
  STATUS_RESPONSE_BYTE0_BITFIELD,
} from "@src/serialHCPClient";
import { HCPPacket } from "@src/parser";
import { afterEach, describe } from "node:test";
import { IntervalReadable } from "./lib/mockup";
import { arraysEqual } from "@src/utils";

// ref: https://stackoverflow.com/a/74957308/12544140
jest.mock("serialport", () => {
  return {
    ...jest.requireActual("serialport"),
    SerialPort: jest.fn().mockImplementation((options) => new SerialPortMock(options)),
  };
});

describe("Broadcast messages unpacking", () => {
  it("should throw if payload of invalid length", () => {
    expect(() => {
      SerialHCPClient.unpackBroadcast(HCPPacket.fromBuffer(Buffer.from("0003aabbcce8", "hex")));
    }).toThrow("Payload aabbcc of length 3, expecting 2");
  });

  it("should return the right 2 status bytes", () => {
    const status = SerialHCPClient.unpackBroadcast(
      HCPPacket.fromBuffer(Buffer.from("0002aacc1f", "hex")),
    );
    const expected = [0xaa, 0xcc];
    expect(status.length).toEqual(2);
    expect(status[0]).toEqual(expected[0]);
    expect(status[1]).toEqual(expected[1]);
  });

  it("should return a valid broadcast status bitfield value", () => {
    const status = SerialHCPClient.unpackBroadcast(
      HCPPacket.fromBuffer(Buffer.from("00d20e0218", "hex")),
    );
    // test with an actual status payload
    const bitfield = SerialHCPClient.extractBitfield(status[0]);
    expect(bitfield).toEqual([false, true, true, true, false, false, false, false]);
    expect(bitfield[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_CLOSED]).toBe(false);
    expect(bitfield[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_OPENED]).toBe(true);
    expect(bitfield[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_MOVING]).toBe(false);
    expect(bitfield[BROADCAST_STATUS_BYTE0_BITFIELD.LIGHT_RELAY_ON]).toBe(true);
    expect(bitfield[BROADCAST_STATUS_BYTE0_BITFIELD.ERROR_ACTIVE]).toBe(false);
  });
});

describe("Slave status response payload creation", () => {
  it("should build default status response payloads", () => {
    // default slave status response is [SLAVE_STATUS_RESPONSE, 0x00, 0x10];
    // emergency stop response is [SLAVE_STATUS_RESPONSE, 0x00, 0x00];
    expect(SerialHCPClient.createSlaveStatusPayload([])).toEqual([0x29, 0x00, 0x10]);
    expect(SerialHCPClient.createSlaveStatusPayload([], true)).toEqual([0x29, 0x00, 0x00]);
  });

  it("should build open/close status response", () => {
    expect(SerialHCPClient.createSlaveStatusPayload([STATUS_RESPONSE_BYTE0_BITFIELD.OPEN])).toEqual(
      [0x29, 0x01, 0x10],
    );
    expect(
      SerialHCPClient.createSlaveStatusPayload([STATUS_RESPONSE_BYTE0_BITFIELD.CLOSE]),
    ).toEqual([0x29, 0x02, 0x10]);
    // simultaneous OPEN / CLOSE is considered valid
    expect(
      SerialHCPClient.createSlaveStatusPayload([
        STATUS_RESPONSE_BYTE0_BITFIELD.CLOSE,
        STATUS_RESPONSE_BYTE0_BITFIELD.OPEN,
      ]),
    ).toEqual([0x29, 0x03, 0x10]);
  });
});

describe("SerialHCPClient low-level", () => {
  const serialPath = "/dev/test";

  afterEach(() => {
    MockBinding.reset();
  });

  describe("Slave commands processing", () => {
    MockBinding.createPort(serialPath, { echo: false, record: false });
    const client = new SerialHCPClient({ path: serialPath, baudRate: 19200 });

    it("should throw if bad slave msg", () => {
      const badScan = HCPPacket.fromBuffer(Buffer.from("00d20e0218", "hex"));
      expect(() => {
        client.processSlaveCommand(badScan);
      }).toThrow("Unknown slave command code 14 in packet 00d20e0218");
    });

    it("should respond to good slave scan", () => {
      const slaveScan = HCPPacket.fromBuffer(Buffer.from("28d2018022", "hex"));
      const response = client.processSlaveCommand(slaveScan);
      // default slave scan response is [UAP1_TYPE, UAP1_ADDR];
      expect(response.payload).toEqual([0x02, 0x28]);
    });

    it.each(["00d20102db", "28d1016b"])("should throw if bad slave scan payload", (pkt) => {
      const badScan = HCPPacket.fromBuffer(Buffer.from(pkt, "hex"));
      expect(() => {
        client.processSlaveCommand(badScan);
      }).toThrow(`Unexpected payload ${pkt.slice(4, -2)} for slave scan packet`);
    });

    it("should respond to good slave status request", () => {
      const slaveStatus = HCPPacket.fromBuffer(Buffer.from("28d1208c", "hex"));
      const response = client.processSlaveCommand(slaveStatus);
      // default slave status response is [SLAVE_STATUS_RESPONSE, 0x00, 0x10];
      expect(response.payload).toEqual([0x29, 0x00, 0x10]);
    });

    it("should respond to bad slave status request", () => {
      const badStatus = HCPPacket.fromBuffer(Buffer.from("80d22080d6", "hex"));
      expect(() => {
        client.processSlaveCommand(badStatus);
      }).toThrow(`Unexpected payload length for slave status request (2)`);
    });
  });

  describe("Slave command responses", () => {
    MockBinding.createPort(serialPath, { echo: false, record: false });
    const client = new SerialHCPClient({ path: serialPath });

    it("should ignore packet not addressed to slave", () => {
      // testing with another destination address 0xaa
      const anotherPkt = HCPPacket.fromBuffer(Buffer.from("aad12051", "hex"));
      client.nextMessageCounter = 0xd;
      const response = client.processMessage(anotherPkt);
      // default slave status response is [SLAVE_STATUS_RESPONSE, 0x00, 0x10];
      expect(response).toBe(null);
    });

    it("should throw an error when slave message counter is not expected", () => {
      const pkt = HCPPacket.fromBuffer(Buffer.from("28d1208c", "hex"));
      expect(() => {
        client.processMessage(pkt);
      }).toThrow("Invalid message counter, got 13 expected 1");
    });

    it("should handle correctly slave message counters", () => {
      const pkt1 = HCPPacket.fromBuffer(Buffer.from("28f12022", "hex"));
      const pkt2 = HCPPacket.fromBuffer(Buffer.from("28012036", "hex"));
      // fake next message counter set to the expected value
      client.nextMessageCounter = 15;
      client.processMessage(pkt1);
      // check incremented counter is right (16 modulo 16 == 0)
      expect(client.nextMessageCounter).toEqual(0);
      const response2 = client.processMessage(pkt2);
      // response counter matches next counter
      expect(response2?.counter).toEqual(1);
      expect(client.nextMessageCounter).toEqual(1);
    });

    it("should sync message counter on broadcast", () => {
      client.nextMessageCounter = -1;
      // test with the 3 kinds of message
      // pk1: broadcast will cause counter force sync
      // pk2: another address, message ignored but counter incremented
      // pk3: slave address with incremented counter
      const pkt1 = HCPPacket.fromBuffer(Buffer.from("00820e023c", "hex"));
      const pkt2 = HCPPacket.fromBuffer(Buffer.from("aa91200a", "hex"));
      const pkt3 = HCPPacket.fromBuffer(Buffer.from("28a1202e", "hex"));
      let response = client.processMessage(pkt1);
      expect(response).toBe(null);
      expect(client.nextMessageCounter).toEqual(9);
      response = client.processMessage(pkt2);
      expect(response).toBe(null);
      expect(client.nextMessageCounter).toEqual(10);
      response = client.processMessage(pkt3);
      expect(response).not.toBe(null);
      expect(response!.counter).toEqual(11);
      expect(client.nextMessageCounter).toEqual(11);
    });

    it("slave scan response should have default callbacks", (done) => {
      const pkt = HCPPacket.fromBuffer(Buffer.from("28d2018022", "hex"));
      client.nextMessageCounter = 13;

      const response = client.processMessage(pkt);
      client.on("init", (p) => {
        expect(p.equals(pkt)).toBe(true);
        done();
      });
      expect(response?.reject).toThrow("could not respond to scan");
      response?.resolve?.(pkt);
    });

    it("slave status response should have default callbacks", () => {
      const pkt = HCPPacket.fromBuffer(Buffer.from("28d1208c", "hex"));
      client.nextMessageCounter = 13;

      const response = client.processMessage(pkt);
      expect(typeof response?.resolve).toBe("function");
      expect(response?.reject).toThrow("could not respond to slave status request");
    });
  });

  describe("Sync break", () => {
    // didn't find much apart from checking the break duration
    it("should perform a sync break for the right duration", (done) => {
      MockBinding.createPort(serialPath, { echo: false, record: false });
      const client = new SerialHCPClient({ path: serialPath });
      client.once("open", () => {
        const start = performance.now();
        client.sendBreak(100, () => {
          const execTime = performance.now() - start;
          expect(execTime).toBeGreaterThan(100);
          done();
        });
      });
    });
  });

  describe("Sending commands", () => {
    MockBinding.createPort(serialPath, { echo: false, record: true });
    const client = new SerialHCPClient({ path: serialPath });

    describe("sendPacket tests", () => {
      it("should send packet without delay", () => {
        const buf = Buffer.from([0x80, 0xf3, 0x29, 0x00, 0x10, 0x08]);
        return client.sendPacket(HCPPacket.fromBuffer(buf)).then(() => {
          expect((client.port.port as unknown as MockPortBinding).lastWrite).toEqual(buf);
        });
      });

      it("should send packet with appropriate delay", async () => {
        const buf = Buffer.from("28d1208c", "hex");
        const start = performance.now();
        await client.sendPacket(HCPPacket.fromBuffer(buf), 100);
        const execTime = performance.now() - start;
        expect((client.port.port as unknown as MockPortBinding).lastWrite).toEqual(buf);
        expect(execTime).toBeGreaterThan(100);
      });
    });
  });
});

describe("SerialHCPClient high-level", () => {
  const serialPath = "/dev/test";

  afterEach(() => {
    MockBinding.reset();
  });

  it("should auto-open port when instanciated", (done) => {
    MockBinding.createPort(serialPath, { echo: false, record: false });
    const client = new SerialHCPClient({ path: serialPath });
    client.on("open", done);
  });

  it("should fire 'close' when closing client", (done) => {
    MockBinding.createPort(serialPath, { echo: false, record: false });
    const client = new SerialHCPClient({
      path: serialPath,
      autoOpen: false,
    });

    client.once("close", () => {
      expect(client.port.isOpen).toBe(false);
      done();
    });
    client.once("open", client.close);
    expect(client.port.isOpen).toBe(false); // autoOpen is false
    client.open();
  });

  it.each([0x0d, 0xaa])(
    /**
     * no matter the counter it's gonna be accepted for broadcast messages
     */
    "should unpack broadcast messages - counter %i",
    (nextMessageCounter, done) => {
      MockBinding.createPort(serialPath, { echo: false, record: false });
      const client = new SerialHCPClient({ path: serialPath });
      client.once("error", (error) => {
        done(error);
      });

      client.once("open", () => {
        // set fake counter to match the incoming packet
        client.nextMessageCounter = nextMessageCounter;
        (client.port.port as unknown as MockPortBinding).emitData(Buffer.from("00d20e0218", "hex"));
      });

      client.on("data", (payload: Uint8Array) => {
        try {
          // byte 0 holds the actual door status
          expect(payload[0]).toBe(0x0e);
          // byte 1 is not checked and assumed to be 0x02
          expect(payload[1]).toBe(0x02);
          done();
        } catch (error) {
          done(error);
        }
      });
    },
  );

  it("should push command at the next slave status request", () => {
    MockBinding.createPort(serialPath, { echo: false, record: true });
    const client = new SerialHCPClient({ path: serialPath });
    expect(client.sendQueue.length).toEqual(0);
    const promise = client.pushCommand([STATUS_RESPONSE_BYTE0_BITFIELD.OPEN]);
    expect(client.sendQueue.length).toEqual(1);
    client.once("open", () => {
      client.nextMessageCounter = 0x0d;
      // trigger slave status request to allow the next command to be pushed
      (client.port.port as unknown as MockPortBinding).emitData(Buffer.from("28d1208c", "hex"));
    });

    return promise.then((p) => {
      expect(client.sendQueue.length).toEqual(0);
      const buf = Buffer.from("80e32901107a", "hex");
      expect((client.port.port as unknown as MockPortBinding).lastWrite).toEqual(buf);
      expect(p.equals(HCPPacket.fromBuffer(buf))).toBe(true);
    });
  });

  it("should respond correctly to startup data", (done) => {
    MockBinding.createPort(serialPath, { echo: false, record: true });
    const client = new SerialHCPClient(
      { path: serialPath },
      { filterBreaks: true, filterMaxLength: true, packetTimeout: 5 },
    );
    // fake nextMessageCounter start
    client.nextMessageCounter = 0x06;
    // use actual data with simulated timings
    const readable = new IntervalReadable({ interval: 10 });
    client.once("open", () => {
      readable.on("data", (chunk) => {
        (client.port.port as unknown as MockPortBinding).emitData(chunk);
      });
      readable.put([
        Buffer.from("0029620180de", "hex"),
        Buffer.from("0000720d026f", "hex"),
        Buffer.from("002882018006", "hex"),
      ]);
    });

    let broadcastStatus: Uint8Array;
    // capture broadcast update
    client.on("data", (status) => {
      broadcastStatus = status;
    });
    // ensure it responds to slave scan to check everything
    client.on("init", (pkt) => {
      try {
        expect(pkt.equals(HCPPacket.fromBuffer(Buffer.from("8092022885", "hex")))).toBe(true);
        expect(arraysEqual(broadcastStatus, [0x0d, 0x02])).toBe(true);
        done();
      } catch (error) {
        done(error);
      }
    });
  });
});
