import { EventEmitter } from "events";

import { CurrentDoorState, GarageState } from "./garagedoor";
import {
  BROADCAST_STATUS_BYTE0_BITFIELD,
  DIRECTION,
  HCPClient,
  STATUS_RESPONSE_BYTE0_BITFIELD,
} from "./serialHCPClient";
import { HCPPacket } from "./parser";

// TODO: write some doc
export class MockHCPClient extends EventEmitter implements HCPClient {
  // keeping track of the parent garageState can be useful
  public mockState: GarageState = { door: CurrentDoorState.CLOSED, light: false };

  constructor(
    public pushCommandMock: (
      flags: STATUS_RESPONSE_BYTE0_BITFIELD[],
      emergencyStop: boolean,
    ) => Promise<HCPPacket> = () =>
      new Promise((resolve) => {
        // just a dummy packet return after 30ms
        setTimeout(() => {
          resolve(HCPPacket.fromData(0x80, 0x01, [0xff, 0xff]));
        }, 30);
      }),
  ) {
    super();
  }

  inferPushCommandMock(
    flags: STATUS_RESPONSE_BYTE0_BITFIELD[],
    emergencyStop: boolean,
  ): Promise<HCPPacket> {
    /** smarter pushCommandMock method that infers what to emit based on command and mockState */
    let callback = null;
    if (emergencyStop === true) {
      callback = () => {
        this.emitDoorState(CurrentDoorState.STOPPED);
      };
    } else {
      // infer next state
      const nextState = MockHCPClient.responseStatusToNextState(flags, this.mockState);
      callback = () => {
        this.emitGarageState(nextState);
      };
    }
    return new Promise((resolve) => {
      // TODO: parametrize timeout values
      // confirm command received after 30ms
      setTimeout(() => {
        resolve(HCPPacket.fromData(0x80, 0x01, [0xff, 0xff]));
        // emit next door state after 100ms
        setTimeout(callback, 100);
      }, 30);
    });
  }

  pushCommand(
    flags: STATUS_RESPONSE_BYTE0_BITFIELD[],
    emergencyStop: boolean = false,
  ): Promise<HCPPacket> {
    return this.pushCommandMock(flags, emergencyStop);
  }

  static doorStateToBroadcastStatus(state: CurrentDoorState): Uint8Array {
    const status = new Uint8Array(2);
    // set arbitrary 2nd status byte value
    status[1] = 0xff;
    switch (state) {
      case CurrentDoorState.CLOSED:
        status[0] = 1 << BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_CLOSED;
        break;
      case CurrentDoorState.OPEN:
        status[0] = 1 << BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_OPENED;
        break;
      case CurrentDoorState.CLOSING: {
        status[0] = 1 << BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_MOVING;
        // set direction
        status[0] |= (1 << BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_DIRECTION) * DIRECTION.CLOSING;
        break;
      }
      case CurrentDoorState.OPENING: {
        status[0] = 1 << BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_MOVING;
        // set direction
        status[0] |= (1 << BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_DIRECTION) * DIRECTION.OPENING;
        break;
      }
      case CurrentDoorState.VENTING:
        status[0] = 1 << BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_VENTING;
        break;
      case CurrentDoorState.STOPPED:
        status[0] = 1 << BROADCAST_STATUS_BYTE0_BITFIELD.ERROR_ACTIVE;
        break;
    }
    return status;
  }

  static lightStateToBroadcastStatus(state: boolean, initialState: number = 0x01): Uint8Array {
    const status = new Uint8Array(2);
    status[0] = initialState;
    status[1] = 0xff;
    if (state === true) {
      // light on flag is set, else nothing is set
      status[0] |= 1 << BROADCAST_STATUS_BYTE0_BITFIELD.LIGHT_RELAY_ON;
    }
    return status;
  }

  static responseStatusToNextState(
    flags: STATUS_RESPONSE_BYTE0_BITFIELD[],
    currentState: GarageState,
  ): GarageState {
    /** guess logical next state from input command and current state */
    const nextState = currentState;
    if (flags.includes(STATUS_RESPONSE_BYTE0_BITFIELD.TOGGLE_LIGHT)) {
      nextState.light = !currentState.light;
    }
    if (flags.includes(STATUS_RESPONSE_BYTE0_BITFIELD.VENTING)) {
      nextState.door = CurrentDoorState.VENTING;
    } else if (flags.includes(STATUS_RESPONSE_BYTE0_BITFIELD.CLOSE)) {
      nextState.door =
        currentState.door === CurrentDoorState.CLOSED
          ? CurrentDoorState.CLOSED
          : CurrentDoorState.CLOSING;
    } else if (flags.includes(STATUS_RESPONSE_BYTE0_BITFIELD.OPEN)) {
      nextState.door =
        currentState.door === CurrentDoorState.OPEN
          ? CurrentDoorState.OPEN
          : CurrentDoorState.OPENING;
    }

    return nextState;
  }

  emitGarageState(state: GarageState): boolean {
    const nextState = MockHCPClient.lightStateToBroadcastStatus(
      state.light,
      MockHCPClient.doorStateToBroadcastStatus(state.door)[0],
    );
    const success = this.emit("data", nextState);
    if (success === true) this.mockState = state;
    return success;
  }

  emitDoorError(): boolean {
    const status = new Uint8Array(2);
    status[0] = 1 << BROADCAST_STATUS_BYTE0_BITFIELD.ERROR_ACTIVE;
    return this.emit("data", status);
  }

  emitDoorState(state: CurrentDoorState): boolean {
    return this.emit("data", MockHCPClient.doorStateToBroadcastStatus(state));
  }

  emitLightState(state: boolean, initialState?: number): boolean {
    return this.emit("data", MockHCPClient.lightStateToBroadcastStatus(state, initialState));
  }
}
