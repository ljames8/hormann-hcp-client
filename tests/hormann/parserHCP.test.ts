import { HCPPacket, SimpleHCPPacketParser, BatchHCPPacketParser } from "@src/hormann/parserHCP";

const TEST_PACKET_STR = "80f329001008"
const TEST_PACKET_BUF = Buffer.from(TEST_PACKET_STR, "hex")
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
  "80a3290010f480d3290010c680032900100b8033290010a280632900105e80932900105d", "hex"
)

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
  })

  it("should be formatted as hex string", () => {
    const hexString = TEST_PACKET_STR
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
  })

  it("should not throw any error if not validating packet", () => {
    const p = HCPPacket.fromBuffer([0x00, 0x00, 0x00, 0x00], false);
    expect(p.isValid()).toBe(false);
  })

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
  })

  it("should not throw any error if not validating crc", () => {
    const p = HCPPacket.fromData(...[0x00, 14, [0x00], 0x00], false);
    expect(p.isValid()).toBe(false);
  })
});

describe("HCPPacket properties", () => {
  const p = HCPPacket.fromBuffer(TEST_PACKET_BUF);

  test("single byte fields should be good", () => {
    expect(p.address).toBe(0x80);
    expect(p.crc).toBe(0x08);
    expect(p.lengthNibble).toBe(0x03);
    expect(p.counterNibble).toBe(0x0f);
  })

  test("header and payload should be good", () => {
    expect(p.header.equals([0x80, 0xf3])).toBe(true);
    expect(p.payload.equals([0x29, 0x00, 0x10, 0x08])).toBe(true);
  })
})

describe("SimpleHCPPacketParser test", () => {
  it("should parse a single packet chunk", () => {
    const parser = new SimpleHCPPacketParser();
    const chunks: HCPPacket[] = [];
    parser.on('data', (chunk) => {chunks.push(chunk)});
    parser.write(TEST_PACKET_BUF);
    parser.end();
    expect(chunks.length).toBe(1);
    expect(chunks[0].hex()).toBe(TEST_PACKET_STR);
  })

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


describe("BatchHCPPacketParser test", () => {
  it("should parse a single packet chunk", () => {
    const parser = new BatchHCPPacketParser();
    const chunks: HCPPacket[] = [];
    parser.on('data', (chunk) => {chunks.push(chunk)});
    parser.write(TEST_PACKET_BUF);
    parser.end();
    expect(chunks.length).toBe(1);
    expect(chunks[0].hex()).toBe(TEST_PACKET_STR);
  })

  it("should parse contiguous packets", () => {
    const parser = new BatchHCPPacketParser();
    const chunks: HCPPacket[] = [];
    const lastPacket = HCPPacket.fromBuffer(Buffer.from("80932900105d", "hex"));

    parser.on("data", (c) => chunks.push(c));
    parser.write(TEST_PACKETS);
    parser.end();
    expect(chunks.length).toBe(69);
    expect(chunks[chunks.length - 1].equals(lastPacket)).toBe(true);
  })

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
});