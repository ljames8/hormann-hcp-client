import { CurrentDoorState, HormannGarageDoorOpener, TargetDoorState } from "@src/garagedoor";
import { HCPPacket } from "@src/parser";
jest.mock("serialport");

describe("garageDoor static methods", () => {
  it("should convert target states to appropriate hcp requests", () => {
    expect(HormannGarageDoorOpener.targetStateToRequest(TargetDoorState.OPEN)).toEqual({
      flags: [0],
    });
    expect(HormannGarageDoorOpener.targetStateToRequest(TargetDoorState.CLOSED)).toEqual({
      flags: [1],
    });
    expect(HormannGarageDoorOpener.targetStateToRequest(TargetDoorState.VENTING)).toEqual({
      flags: [4],
    });
  });

  it("should convert broadcast status to current door states", () => {
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x01, 0xff]))).toBe(
      CurrentDoorState.CLOSED,
    );
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x02, 0x00]))).toBe(
      CurrentDoorState.OPEN,
    );
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x80, 0x00]))).toBe(
      CurrentDoorState.VENTING,
    );
    // in case of multiple incompatible states, the first checked if kept (opened)
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x03, 0xff]))).toBe(
      CurrentDoorState.OPEN,
    );

    // status that translate to errors
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x00, 0x00]))).toEqual(
      Error("Unknown status"),
    );
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x24, 0x00]))).toEqual(
      Error("Unknown status"),
    );
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x12, 0x00]))).toEqual(
      Error("Error active"),
    );
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x1c, 0xff]))).toEqual(
      Error("Error active"),
    );

    // door moving
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x40, 0x02]))).toBe(
      CurrentDoorState.OPENING,
    );
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x60, 0x03]))).toBe(
      CurrentDoorState.CLOSING,
    );
    // hypothetical status with both closing and closed
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x61, 0x03]))).toBe(
      CurrentDoorState.CLOSING,
    );
  });
});

describe("garageDoor getter methods", () => {
  const garage = new HormannGarageDoorOpener("test", { path: "/doest/not/exist" });

  it("should throw error if states not initialized", () => {
    expect(() => {
      garage.getCurrentState();
    }).toThrow("Current state cannot be retrieved");
    expect(() => {
      garage.getTargetState();
    }).toThrow("Target state is not set");
  });

  it("should update status on data event from serial hcp client", (done) => {
    garage.on("update", (state) => {
      expect(state).toBe(garage.getCurrentState());
      expect(state).toBe(1);
      done();
    });
    // simulate closed broadcast status
    garage.hcpClient.emit("data", Uint8Array.from([0x01, 0xff]));
  });

  it("should emit error when invalid status", (done) => {
    garage.on("error", (error) => {
      expect(error).toEqual(Error("Unknown status"));
      done();
    });
    garage.hcpClient.emit("data", Uint8Array.from([0x00, 0x00]));
  });
});

describe("garageDoor set state", () => {
  const garage = new HormannGarageDoorOpener("test", { path: "/doest/not/exist" });
  let mockPushCOmmand: jest.SpyInstance;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    // simulate dummy behaviour where all commands will pass
    mockPushCOmmand = jest.spyOn(garage.hcpClient, "pushCommand").mockImplementation(() => {
      return Promise.resolve(HCPPacket.fromBuffer(Buffer.from("00d20e0218", "hex")));
    });
    // check door logging
    loggerSpy = jest.spyOn(garage, "logger");
  });

  afterEach(() => {
    jest.restoreAllMocks()
  });

  it("should sucessfully set target state if valid and new", () => {
    return garage.setTargetState(TargetDoorState.OPEN).then(() => {
      expect(garage.getTargetState()).toBe(TargetDoorState.OPEN);
      expect(loggerSpy).toHaveBeenCalledWith("Target state set to OPEN");
    });
  });

  it("should not send command if target state equals current state or unchanged", () => {
    // simulate venting broadcast status
    garage.hcpClient.emit("data", Uint8Array.from([0x80, 0x00]));
    return garage.setTargetState(TargetDoorState.VENTING).then(() => {
      // cover the case when current state is already the target state
      expect(garage.getTargetState()).toBe(TargetDoorState.VENTING);
      expect(loggerSpy).toHaveBeenLastCalledWith("Current state already VENTING(5)");
      expect(mockPushCOmmand).not.toHaveBeenCalled();
      // call again to cover the case when target state is unchanged
      garage.setTargetState(TargetDoorState.VENTING).then(() => {
        expect(loggerSpy).toHaveBeenLastCalledWith("Target state already VENTING(5)");
        expect(mockPushCOmmand).not.toHaveBeenCalled();
      });
    });
  });
});
