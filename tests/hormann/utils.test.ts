import { computeCRC8 } from "@src/hormann/utils"

describe("computeRC8", () => {
    it.each([[], Buffer.alloc(0)])("should throw an error when empty value", (value) => {
        expect(() => {computeCRC8(value)}).toThrow("Bytes cannot be empty");
    })

    it.each([
        {input:[0], expectedCRC: 215},
        {input:[1, 2, 3, 4], expectedCRC: 218},
        {input:[0x80, 0xf3, 0x29, 0x00, 0x10], expectedCRC:  0x08}
    ])("should match expected value", ({input, expectedCRC}) => {
        expect(computeCRC8(input)).toBe(expectedCRC)
    })

    it("should be the same result for both argument types", () => {
        expect(computeCRC8([0])).toEqual(computeCRC8(Buffer.from([0])))
    })
});
