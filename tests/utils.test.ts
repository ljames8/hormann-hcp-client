import { arraysEqual, hex, computeCRC8 } from "@src/utils";

describe("arraysEqual", () => {
  it("should return true for equal arrays", () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(arraysEqual(new Uint8Array(), [])).toBe(true);
    expect(arraysEqual(new Uint8Array(2), [0, 0])).toBe(true);
  })

  it("should return false for inequal arrays", () => {
    expect(arraysEqual([1, 3], [3, 1])).toBe(false);
    expect(arraysEqual([], [3, 1])).toBe(false);
    expect(arraysEqual([0], new Uint8Array())).toBe(false);
  })
})

describe("hex", () => {
  it("should return empty string when empty argument", () => {
    expect(hex([])).toBe('');
  })

  it.each([
    [0xde, 0xad, 0xbe, 0xef],
    Buffer.from("deadbeef", "hex"),
    new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  ])("should display 'deadbeef' hex string", (value) => {
    expect(hex(value)).toBe("deadbeef");
  });
});

describe("computeRC8", () => {
  it.each([[], Buffer.alloc(0)])("should throw an error when empty value", (value) => {
    expect(() => {
      computeCRC8(value);
    }).toThrow("Bytes cannot be empty");
  });

  it.each([
    { input: [0], expectedCRC: 215 },
    { input: [1, 2, 3, 4], expectedCRC: 218 },
    { input: [0x80, 0xf3, 0x29, 0x00, 0x10], expectedCRC: 0x08 },
  ])("should match expected value", ({ input, expectedCRC }) => {
    expect(computeCRC8(input)).toBe(expectedCRC);
  });

  it("should be the same result for both argument types", () => {
    expect(computeCRC8([0])).toEqual(computeCRC8(Buffer.from([0])));
  });
});
