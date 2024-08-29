import {
  HCPPacket,
  PacketFilter,
  SimpleHCPPacketParser,
  BatchHCPPacketParser,
} from "@src/hormann/parser";
import { arraysEqual } from "@src/hormann/utils";
import { IntervalReadable } from "@tests/lib/mockup";

const TEST_PACKET_STR = "80f329001008";
const TEST_PACKET_BUF = Buffer.from(TEST_PACKET_STR, "hex");
const TEST_PACKETS = Buffer.from(
  "000b45453030303437382d30307180121428a78033290010a280632900105e80932900" +
  "105d80c3290010a180f3290010088023290010c58053290010f780832900103a80b329" +
  "00109380e32900106f80132900106c80432900109080732900103980a3290010f480d3" +
  "290010c680032900100b8033290010a280632900105e80932900105d80c3290010a180" +
  "f3290010088023290010c58053290010f780832900103a80b32900109380e32900106f" +
  "80132900106c80432900109080732900103980a3290010f480d3290010c68003290010" +
  "0b8033290010a280632900105e80932900105d80c3290010a180f32900100880232900" +
  "10c58053290010f780832900103a80b32900109380e32900106f80132900106c804329" +
  "00109080732900103980a3290010f480d3290010c680032900100b8033290010a28063" +
  "2900105e80932900105d80c3290010a180f3290010088023290010c58053290010f780" +
  "832900103a80b32900109380e32900106f80132900106c804329001090807329001039" +
  "80a3290010f480d3290010c680032900100b8033290010a280632900105e80932900105d",
  "hex",
);
const TEST_PACKET_HEX_LIST = [
  '000b45453030303437382d303071', '80121428a7', '8033290010a2', '80632900105e',
  '80932900105d', '80c3290010a1', '80f329001008', '8023290010c5', '8053290010f7',
  '80832900103a', '80b329001093', '80e32900106f', '80132900106c', '804329001090',
  '807329001039', '80a3290010f4', '80d3290010c6', '80032900100b', '8033290010a2',
  '80632900105e', '80932900105d', '80c3290010a1', '80f329001008', '8023290010c5',
  '8053290010f7', '80832900103a', '80b329001093', '80e32900106f', '80132900106c',
  '804329001090', '807329001039', '80a3290010f4', '80d3290010c6', '80032900100b',
  '8033290010a2', '80632900105e', '80932900105d', '80c3290010a1', '80f329001008',
  '8023290010c5', '8053290010f7', '80832900103a', '80b329001093', '80e32900106f',
  '80132900106c', '804329001090', '807329001039', '80a3290010f4', '80d3290010c6',
  '80032900100b', '8033290010a2', '80632900105e', '80932900105d', '80c3290010a1',
  '80f329001008', '8023290010c5', '8053290010f7', '80832900103a', '80b329001093',
  '80e32900106f', '80132900106c', '804329001090', '807329001039', '80a3290010f4',
  '80d3290010c6', '80032900100b', '8033290010a2', '80632900105e', '80932900105d'
];
const TEST_PACKET_LIST = TEST_PACKET_HEX_LIST.map((c) => Buffer.from(c, "hex"));

describe("HCPPacket base", () => {
  it("should build a valid packet from buffer", () => {
    const p = HCPPacket.fromBuffer(TEST_PACKET_BUF);
    HCPPacket.fromBuffer([0x80, 0xf3, 0x29, 0x00, 0x10, 0x08]);
    HCPPacket.fromBuffer(Uint8Array.from([0x80, 0xf3, 0x29, 0x00, 0x10, 0x08]));

    expect(p.isValid()).toBe(true);
  });

  it("should build a valid packet from data", () => {
    const p = HCPPacket.fromData(...[0x00, 5, [0x00, 0x01]]);
    expect(p.isValid()).toBe(true);
    expect(p.hex()).toBe("00520001cc");
    // supplying crc from data should not be that useful but supported
    expect(HCPPacket.fromData(...[0x00, 5, [0x00, 0x01], 0xcc]).isValid()).toBe(true);
  });

  it("should be formatted as hex string", () => {
    const hexString = TEST_PACKET_STR;
    const p = HCPPacket.fromBuffer(Buffer.from(hexString, "hex"));
    expect(p.hex()).toBe(hexString);
  });

  it("should throw errors for an invalid packet buffer", () => {
    expect(() => {
      HCPPacket.fromBuffer([]);
    }).toThrow("HCPPacket cannot be shorter than 4 bytes");
    expect(() => {
      HCPPacket.fromBuffer([0x00, 0x00, 0x00]);
    }).toThrow("HCPPacket cannot be shorter than 4 bytes");
    expect(() => {
      HCPPacket.fromBuffer(new Uint8Array(19));
    }).toThrow("HCPPacket cannot be longer than 18 bytes");
  });

  it("should throw errors for invalid packet contents", () => {
    expect(() => {
      HCPPacket.fromBuffer([0x00, 0x00, 0x00, 0x00]);
    }).toThrow("Invalid CRC (got 0x00 expected 0xd1)");
    expect(() => {
      HCPPacket.fromBuffer([0x00, 0x00, 0x00, 0xd1]);
    }).toThrow("Invalid total length (got 3 expected 4)");
  });

  it("should not throw any error if not validating packet", () => {
    const p = HCPPacket.fromBuffer([0x00, 0x00, 0x00, 0x00], false);
    expect(p.isValid()).toBe(false);
  });

  it("should throw errors if data is not valid", () => {
    expect(() => {
      HCPPacket.fromData(...[300, 5, [0x00, 0x01]]);
    }).toThrow("address byte cannot exceed 255");
    expect(() => {
      HCPPacket.fromData(...[0x00, 16, [0x00, 0x01]]);
    }).toThrow("counter nibble cannot exceed 15");
    expect(() => {
      HCPPacket.fromData(...[0x00, 1, [0x00], 257]);
    }).toThrow("crc cannot exceed 255");
    expect(() => {
      HCPPacket.fromData(...[0x00, 1, new Uint8Array(16)]);
    }).toThrow("HCPPacket cannot be longer than 18 bytes");
  });

  it("should not throw any error if not validating crc", () => {
    const p = HCPPacket.fromData(...[0x00, 14, [0x00], 0x00], false);
    expect(p.isValid()).toBe(false);
  });
});

describe("HCPPacket properties", () => {
  const p = HCPPacket.fromBuffer(TEST_PACKET_BUF);

  test("single byte fields should be good", () => {
    expect(p.address).toBe(0x80);
    expect(p.crc).toBe(0x08);
    expect(p.lengthNibble).toBe(0x03);
    expect(p.counterNibble).toBe(0x0f);
  });

  test("header and payload should be good", () => {
    expect(arraysEqual(p.header, [0x80, 0xf3])).toBe(true);
    expect(arraysEqual(p.payload, [0x29, 0x00, 0x10])).toBe(true);
  });
});

describe("SimpleHCPPacketParser test", () => {
  it("should parse a single packet chunk", () => {
    const parser = new SimpleHCPPacketParser();
    const chunks: HCPPacket[] = [];
    parser.on("data", (chunk) => {
      chunks.push(chunk);
    });
    parser.write(TEST_PACKET_BUF);
    parser.end();
    expect(chunks.length).toBe(1);
    expect(chunks[0].hex()).toBe(TEST_PACKET_STR);
  });

  it("should parse contiguous packets", () => {
    const parser = new SimpleHCPPacketParser();
    const chunks: HCPPacket[] = [];
    const lastPacket = HCPPacket.fromBuffer(Buffer.from("80932900105d", "hex"));

    parser.on("data", (c) => chunks.push(c));
    parser.on("end", () => {
      expect(chunks.length).toBe(69);
      expect(chunks[chunks.length - 1].equals(lastPacket)).toBe(true);
    });
    parser.write(TEST_PACKETS);
    parser.end();
  });

  it("is not expected to parse partially corrupted packets", () => {
    const parser = new SimpleHCPPacketParser();
    const chunks: HCPPacket[] = [];

    parser.on("data", (c) => chunks.push(c));
    parser.write(TEST_PACKETS.subarray(1, 17));
    parser.end();
    expect(chunks.length).toBe(0);
  });
});

describe("PacketFilter test", () => {
  test("should respect max length filter", () => {
    const longChunk = Buffer.from("12345678901234567890"); // Length is 20
    const packetFilter = new PacketFilter({ filterMaxLength: true });
    packetFilter._transform(longChunk, "utf-8", () => {
      const transformedChunk = packetFilter.read();
      expect(transformedChunk.length).toBe(18); // MAX_PACKET_LENGTH
      expect(transformedChunk.toString()).toBe("345678901234567890");
    });
  });

  test("should discard sync breaks", () => {
    // warning straightforward first 0x00 byte removal
    // will not work if the sync breaks are intermittent
    const chunk0 = Buffer.from("01deadbeef", "hex");
    const chunk1 = Buffer.from("00deadbeef", "hex");
    const packetFilter = new PacketFilter({ filterBreaks: true });
    packetFilter._transform(chunk0, "hex", () => {
      const transformedChunk = packetFilter.read();
      expect(transformedChunk.toString("hex")).toBe("01deadbeef");
    });
    packetFilter._transform(chunk1, "hex", () => {
      const transformedChunk = packetFilter.read();
      // default transform accumulates all what was read
      expect(transformedChunk.toString("hex")).toBe("01deadbeefdeadbeef");
    });
  });

  test("filterMaxLength has precedence over filterBreaks", () => {
    // Length is 20
    const longChunk = Buffer.from("00123456789012345678aabbccddeeff00112233", "hex");
    const packetFilter = new PacketFilter({ filterMaxLength: true, filterBreaks: true });
    packetFilter._transform(longChunk, "hex", () => {
      const transformedChunk = packetFilter.read();
      expect(transformedChunk.length).toBe(18); // MAX_PACKET_LENGTH
      expect(transformedChunk.toString("hex")).toBe("3456789012345678aabbccddeeff00112233");
    });
  });

  test("should reset buffer after timeout", async () => {
    const packetFilter = new PacketFilter({ packetTimeout: 20 }); // 20ms timeout
    const chunk = Buffer.from("deadbeef", "hex");
    const chunks: Buffer[] = [];
    packetFilter.on("data", (c) => chunks.push(c));
    packetFilter.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, 10));
    packetFilter.write(chunk); // accumulate buffer if not timedout
    await new Promise((resolve) => setTimeout(resolve, 30));
    packetFilter.write(chunk); // reset buffer if not timedout
    packetFilter.end();
    expect(chunks.length).toBe(3);
    expect(chunks[0].equals(chunk)).toBe(true);
    expect(chunks[1].equals(Buffer.concat([chunk, chunk]))).toBe(true);
    expect(chunks[0].equals(chunk)).toBe(true);
  });
});

describe("BatchHCPPacketParser test", () => {
  it("should parse a single packet chunk", () => {
    const parser = new BatchHCPPacketParser();
    const chunks: HCPPacket[] = [];
    parser.on("data", (chunk) => {
      chunks.push(chunk);
    });
    parser.write(TEST_PACKET_BUF);
    parser.end();
    expect(chunks.length).toBe(1);
    expect(chunks[0].hex()).toBe(TEST_PACKET_STR);
  });

  it("should parse contiguous packets", () => {
    const parser = new BatchHCPPacketParser();
    const chunks: HCPPacket[] = [];
    const lastPacket = HCPPacket.fromBuffer(Buffer.from("80932900105d", "hex"));

    parser.on("data", (c) => chunks.push(c));
    parser.write(TEST_PACKETS);
    parser.end();
    expect(chunks.length).toBe(69);
    expect(chunks[chunks.length - 1].equals(lastPacket)).toBe(true);
  });

  it("should be able to parse partially corrupted packets", () => {
    const parser = new BatchHCPPacketParser();
    const chunks: HCPPacket[] = [];
    const lastPacket = HCPPacket.fromBuffer(Buffer.from("8033290010a2", "hex"));

    parser.on("data", (c) => chunks.push(c));
    // passing incomplete packet followed by 2 valid packets
    parser.write(TEST_PACKETS.subarray(1, 25));
    parser.end();
    expect(chunks.length).toBe(2);
    expect(chunks[chunks.length - 1].equals(lastPacket)).toBe(true);
  });

  it("should parse a mostly corrupted packet", () => {
    const parser = new BatchHCPPacketParser();
    const chunks: HCPPacket[] = [];
    const lastPacket = HCPPacket.fromBuffer(Buffer.from("8033290010a2", "hex"));

    parser.on("data", (c) => chunks.push(c));
    // passing long gibberish followed by 2 valid packets
    parser.write(Buffer.from("33221100ffeeffee0011ffeeffee", "hex"));
    parser.write(Buffer.from("ff11eeff11eeffeeff8033290010a2", "hex"));
    parser.write(Buffer.from("ffee00eeff11ffeeffeeffeeff00ffeeff8033290010a2", "hex"));
    parser.end();
    expect(chunks.length).toBe(2);
    expect(chunks[chunks.length - 1].equals(lastPacket)).toBe(true);
  });
});

describe("Real time packet parsing tests", () => {
  test.each([SimpleHCPPacketParser, BatchHCPPacketParser])(
    "simpler parser handles a real time stream of valid packets",
    (parserClass, done) => {
      // Create a mockup stream emitting packets every 10ms by chunks of size 6
      // that's actually quicker than the hardware to save time
      const readable = new IntervalReadable({ interval: 10, chunkSize: 6 });
      const chunks: HCPPacket[] = [];
      // packetTimeout must be < packet interval
      const parser = new parserClass({ packetTimeout: 5 });
      parser.on("data", (chunk) => {
        chunks.push(chunk);
      });
      // prepend some corrupted packet of same size. it should be discarded after timeout
      readable.write(Buffer.from("deadbeef", "hex"));
      readable.put(TEST_PACKET_LIST);
      readable.end();
      parser.on("finish", () => {
        try {
          expect(chunks.length).toBe(69);
          done();
        } catch (error) {
          console.log(parserClass);
          done(error);
        }
      });
      readable.pipe(parser);
    },
    1000,
  );
});
