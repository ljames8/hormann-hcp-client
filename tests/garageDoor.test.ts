import { CurrentDoorState, HormannGarageDoorOpener, TargetDoorState } from "@src/garagedoor";
import { SerialHCPClient } from "@src/serialHCPClient";
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
      flags: [3],
    });
  });

  it("should convert broadcast status to current door states", () => {
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x01, 0xff]))).toEqual({
      door: CurrentDoorState.CLOSED,
      light: false,
    });
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x02, 0x00]))).toEqual({
      door: CurrentDoorState.OPEN,
      light: false,
    });
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x80, 0x00]))).toEqual({
      door: CurrentDoorState.VENTING,
      light: false,
    });
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x88, 0x00]))).toEqual({
      door: CurrentDoorState.VENTING,
      light: true,
    });
    // in case of multiple incompatible states, the first checked if kept (opened)
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x03, 0xff]))).toEqual({
      door: CurrentDoorState.OPEN,
      light: false,
    });

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
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x40, 0x02]))).toEqual({
      door: CurrentDoorState.OPENING,
      light: false,
    });
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x60, 0x03]))).toEqual({
      door: CurrentDoorState.CLOSING,
      light: false,
    });
    // hypothetical status with both closing and closed
    expect(HormannGarageDoorOpener.broadcastToCurrentState(Uint8Array.from([0x61, 0x03]))).toEqual({
      door: CurrentDoorState.CLOSING,
      light: false,
    });
  });
});

describe("garageDoor getter methods", () => {
  let garage: HormannGarageDoorOpener;
  beforeEach(() => {
    garage = new HormannGarageDoorOpener("test", new SerialHCPClient({ path: "/does/not/exist" }));
  });

  it("should throw error if states not initialized", () => {
    expect(() => {
      garage.getCurrentState();
    }).toThrow("Current state cannot be retrieved");
    expect(() => {
      garage.getTargetState();
    }).toThrow("Target state is not set");
    expect(() => {
      garage.getLightOnState();
    }).toThrow("Light state is not set");
  });

  it("should update door status on data event from serial hcp client", () => {
    const doorHandler = jest.fn();
    garage.on("update_door", doorHandler);

    // door closed + light on/off (twice)
    garage.hcpClient.emit("data", Uint8Array.from([0x01 + 0x08, 0xff]));
    garage.hcpClient.emit("data", Uint8Array.from([0x01, 0xff]));
    let doorState = garage.getCurrentState();
    expect(doorHandler).toHaveBeenCalledTimes(1);
    expect(doorHandler).toHaveBeenCalledWith(doorState);
    expect(doorState).toBe(1);

    // door open
    garage.hcpClient.emit("data", Uint8Array.from([0x02, 0xff]));
    doorState = garage.getCurrentState();
    expect(doorHandler).toHaveBeenCalledTimes(2);
    expect(doorHandler).toHaveBeenLastCalledWith(doorState);
    expect(doorState).toBe(0);
  });

  it("should update light status on data event from serial hcp client", () => {
    const lightHandler = jest.fn();
    garage.on("update_light", lightHandler);
    // simulate light off + door open/close broadcast status twice
    garage.hcpClient.emit("data", Uint8Array.from([0x02, 0xff]));
    garage.hcpClient.emit("data", Uint8Array.from([0x01, 0xff]));
    let lightState = garage.getLightOnState();
    expect(lightHandler).toHaveBeenCalledTimes(1);
    expect(lightHandler).toHaveBeenCalledWith(lightState);
    expect(lightState).toBe(false);
    // simulate light on + door closed broadcast status
    garage.hcpClient.emit("data", Uint8Array.from([0x02 + 0x08, 0xff]));
    lightState = garage.getLightOnState();
    expect(lightHandler).toHaveBeenCalledTimes(2);
    expect(lightHandler).toHaveBeenLastCalledWith(lightState);
    expect(lightState).toBe(true);
  });

  it("should emit error when invalid status", (done) => {
    // set status to arbitrary not null to ensure a change on data
    garage.broadcastStatus[0] = 0xff;
    garage.on("error", (error) => {
      expect(error).toEqual(Error("Unknown status"));
      done();
    });
    garage.hcpClient.emit("data", Uint8Array.from([0x00, 0x00]));
  });
});

describe("garageDoor set state", () => {
  const garage = new HormannGarageDoorOpener(
    "test",
    new SerialHCPClient({ path: "/does/not/exist" }),
  );
  let mockPushCommand: jest.SpyInstance;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    // simulate dummy behaviour where all commands will pass
    mockPushCommand = jest.spyOn(garage.hcpClient, "pushCommand").mockImplementation(() => {
      return Promise.resolve(HCPPacket.fromBuffer(Buffer.from("00d20e0218", "hex")));
    });
    // check door logging
    loggerSpy = jest.spyOn(garage, "logger");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should sucessfully set target door state if valid and new", () => {
    return garage.setTargetState(TargetDoorState.OPEN).then(() => {
      expect(garage.getTargetState()).toBe(TargetDoorState.OPEN);
      expect(loggerSpy).toHaveBeenCalledWith("Target state set to OPEN");
    });
  });

  it("should sucessfully set target light state if valid and new", () => {
    return garage.setLightOnState(true).then(() => {
      // simulate light on broadcast status
      garage.hcpClient.emit("data", Uint8Array.from([0x01 + 0x08, 0x00]));
      expect(garage.getLightOnState()).toBe(true);
      expect(loggerSpy).toHaveBeenCalledWith("Current light state now true");
    });
  });

  it("should not send command if target state equals current state or unchanged", () => {
    // simulate venting broadcast status
    garage.hcpClient.emit("data", Uint8Array.from([0x80, 0x00]));
    return garage.setTargetState(TargetDoorState.VENTING).then(() => {
      // cover the case when current state is already the target state
      expect(garage.getTargetState()).toBe(TargetDoorState.VENTING);
      expect(loggerSpy).toHaveBeenLastCalledWith("Current state already VENTING(5)");
      expect(mockPushCommand).not.toHaveBeenCalled();
      // call again to cover the case when target state is unchanged
      garage.setTargetState(TargetDoorState.VENTING).then(() => {
        expect(loggerSpy).toHaveBeenLastCalledWith("Target state already VENTING(5)");
        expect(mockPushCommand).not.toHaveBeenCalled();
      });
    });
  });

  it("should not send command if light state equals current state or unchanged", () => {
    // simulate light on broadcast status
    garage.hcpClient.emit("data", Uint8Array.from([0x80 + 0x00, 0x00]));
    return garage.setLightOnState(false).then(() => {
      expect(garage.getLightOnState()).toBe(false);
      expect(loggerSpy).toHaveBeenLastCalledWith("Light On state already false");
      expect(mockPushCommand).not.toHaveBeenCalled();
    });
  });
});
