import { CurrentDoorState, HormannGarageDoorOpener, TargetDoorState } from "@src/garagedoor";
import { MockHCPClient } from "@src/mockHCPClient";
import { STATUS_RESPONSE_BYTE0_BITFIELD } from "@src/serialHCPClient";


describe("MockHCPClient tests", () => {
  it("should mock the right broadcast statuses from given door states", () => {
    expect(MockHCPClient.doorStateToBroadcastStatus(CurrentDoorState.CLOSED)).toEqual(
      Uint8Array.from([0x01, 0xff]),
    );
    expect(MockHCPClient.doorStateToBroadcastStatus(CurrentDoorState.OPEN)).toEqual(
      Uint8Array.from([0x02, 0xff]),
    );
    expect(MockHCPClient.doorStateToBroadcastStatus(CurrentDoorState.VENTING)).toEqual(
      Uint8Array.from([0x80, 0xff]),
    );
    expect(MockHCPClient.doorStateToBroadcastStatus(CurrentDoorState.CLOSING)).toEqual(
      Uint8Array.from([0x60, 0xff]),
    );
    expect(MockHCPClient.doorStateToBroadcastStatus(CurrentDoorState.OPENING)).toEqual(
      Uint8Array.from([0x40, 0xff]),
    );
  });

  it("should mock the right broadcast statuses from light states", () => {
    expect(MockHCPClient.lightStateToBroadcastStatus(false)).toEqual(Uint8Array.from([0x01, 0xff]));
    expect(MockHCPClient.lightStateToBroadcastStatus(true)).toEqual(Uint8Array.from([0x09, 0xff]));
    expect(MockHCPClient.lightStateToBroadcastStatus(false, 0x02)).toEqual(
      Uint8Array.from([0x02, 0xff]),
    );
  });

  it("should infer the right following states from previous ones", () => {
    // closed > opening
    expect(
      MockHCPClient.responseStatusToNextState([STATUS_RESPONSE_BYTE0_BITFIELD.OPEN], {
        door: CurrentDoorState.CLOSED,
        light: false,
      }),
    ).toEqual({door: CurrentDoorState.OPENING, light: false});
    // opened > closing
    expect(
      MockHCPClient.responseStatusToNextState([STATUS_RESPONSE_BYTE0_BITFIELD.CLOSE], {
        door: CurrentDoorState.OPEN,
        light: false,
      }),
    ).toEqual({door: CurrentDoorState.CLOSING, light: false});
    // already opened
    expect(
      MockHCPClient.responseStatusToNextState([STATUS_RESPONSE_BYTE0_BITFIELD.CLOSE], {
        door: CurrentDoorState.CLOSED,
        light: false,
      }),
    ).toEqual({door: CurrentDoorState.CLOSED, light: false});
    // already closed
    expect(
      MockHCPClient.responseStatusToNextState([STATUS_RESPONSE_BYTE0_BITFIELD.OPEN], {
        door: CurrentDoorState.OPEN,
        light: false,
      }),
    ).toEqual({door: CurrentDoorState.OPEN, light: false});
  });

  describe("MockHCPClient instanciated tests", () => {
    let mock: MockHCPClient;
    let mockGarageDoor: HormannGarageDoorOpener;

    beforeEach(() => {
      mock = new MockHCPClient();
      mockGarageDoor = new HormannGarageDoorOpener(undefined, mock);
    });

    it("should display the right name", () => {
      expect(mockGarageDoor.name).toBe("Hörmann Garage Door");
    });

    it("should emit an error when requested", (done) => {
      mockGarageDoor.once("error", (err) => {
        expect(err).toEqual(new Error("Error active"));
        done();
      });
      mock.emitDoorError();
    });

    it("should emit mocked door states", () => {
      // state not set
      expect(() => {
        mockGarageDoor.getCurrentState();
      }).toThrow();
      mock.emitDoorState(CurrentDoorState.OPENING);
      expect(mockGarageDoor.getCurrentState()).toBe(CurrentDoorState.OPENING);
      mock.emitDoorState(CurrentDoorState.CLOSED);
      expect(mockGarageDoor.getCurrentState()).toBe(CurrentDoorState.CLOSED);
    });

    it("should emit mocked light states", () => {
      // state set (side-effect from previous test)
      mock.emitLightState(false);
      expect(mockGarageDoor.getLightOnState()).toBe(false);
      mock.emitLightState(true);
      expect(mockGarageDoor.getLightOnState()).toBe(true);
    });

    it("should emit mocked garage states", () => {
      mock.emitGarageState({ door: CurrentDoorState.OPEN, light: true });
      expect(mockGarageDoor.getCurrentState()).toBe(CurrentDoorState.OPEN);
      expect(mockGarageDoor.getLightOnState()).toBe(true);
    });

    it("should mock pushing some commands to the hcp client", () => {
      mock.emitDoorState(CurrentDoorState.CLOSED);
      expect(() => {
        mockGarageDoor.getTargetState();
      }).toThrow();
      return mockGarageDoor.setTargetState(TargetDoorState.OPEN).then(() => {
        expect(mockGarageDoor.getTargetState()).toBe(TargetDoorState.OPEN);
      });
    });

    it("should allow to infer some mock states", async () => {
      // change push command callback to infer the next state automatically
      mock.pushCommandMock = mock.inferPushCommandMock;

      const handleDoorUpdate = (expectedValue: CurrentDoorState) =>
        new Promise<void>((resolve) => {
          mockGarageDoor.once("update_door", (state: CurrentDoorState) => {
            expect(state).toBe(expectedValue);
            resolve();
          });
        });
      const handleLightUpdate = (expectedValue: boolean) =>
        new Promise<void>((resolve) => {
          mockGarageDoor.once("update_light", (state: boolean) => {
            expect(state).toBe(expectedValue);
            resolve();
          });
        });

      const errorEvent = new Promise<void>((resolve) => {
        mockGarageDoor.once("error", (err) => {
          expect(err).toEqual(new Error("Error active"));
          resolve();
        });
      });

      // test closing
      mock.emitGarageState({ door: CurrentDoorState.OPEN, light: false });
      await mockGarageDoor
        .setTargetState(TargetDoorState.CLOSED)
        .then(() => {
          expect(mockGarageDoor.getTargetState()).toBe(TargetDoorState.CLOSED);
          // state not yet changed
          expect(mockGarageDoor.getCurrentState()).toBe(CurrentDoorState.OPEN);
        })
        .then(() => handleDoorUpdate(CurrentDoorState.CLOSING));

      // test opening
      mock.emitGarageState({ door: CurrentDoorState.CLOSED, light: false });
      await mockGarageDoor
        .setTargetState(TargetDoorState.OPEN)
        .then(() => {
          expect(mockGarageDoor.getTargetState()).toBe(TargetDoorState.OPEN);
          // state not yet changed
          expect(mockGarageDoor.getCurrentState()).toBe(CurrentDoorState.CLOSED);
        })
        .then(() => handleDoorUpdate(CurrentDoorState.OPENING));

      // test venting
      mock.emitGarageState({ door: CurrentDoorState.OPEN, light: false });
      await mockGarageDoor
        .setTargetState(TargetDoorState.VENTING)
        .then(() => {
          expect(mockGarageDoor.getTargetState()).toBe(TargetDoorState.VENTING);
          // state not yet changed
          expect(mockGarageDoor.getCurrentState()).toBe(CurrentDoorState.OPEN);
        })
        .then(() => handleDoorUpdate(CurrentDoorState.VENTING));

      // emergency stop emits an error, STOPPED not (yet) emitted (see onBroadcast)
      await mock.pushCommand([], true).then(() => errorEvent);
      // test lights on
      mock.emitGarageState({ door: CurrentDoorState.VENTING, light: false });
      await mockGarageDoor
        .setLightOnState(true)
        .then(() => {
          // state not yet changed
          expect(mockGarageDoor.getLightOnState()).toBe(false);
        })
        .then(() => handleLightUpdate(true));
    });
  });
});
