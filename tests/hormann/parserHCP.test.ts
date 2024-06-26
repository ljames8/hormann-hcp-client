import { HCPPacket } from "@src/hormann/parserHCP";

describe("HCPPacket base", () => {
  it("should parse a valid packet buffer", () => {
    const p = HCPPacket.fromBuffer(Buffer.from("80f329001008", "hex"));
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
    const hexString = "80f329001008"
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
  const p = HCPPacket.fromBuffer(Buffer.from("80f329001008", "hex"));
  test("single byte fields should be good", () => {
    expect(p.address).toBe(0x80);
    expect(p.crc).toBe(0x08);
    expect(p.lengthNibble).toBe(0x03);
    expect(p.counterNibble).toBe(0x0f);
  })
})

