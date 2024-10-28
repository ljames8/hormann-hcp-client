import { EventEmitter } from "events";

import Debug, { Debugger } from "debug";

import {
  HCPClient,
  SerialHCPClient,
  SerialOptions,
  STATUS_RESPONSE_BYTE0_BITFIELD,
  BROADCAST_STATUS_BYTE0_BITFIELD,
  DIRECTION,
} from "./serialHCPClient";
import { HCPPacket, PacketFilterParams } from "./parser";

export { SerialOptions, PacketFilterParams };

export enum CurrentDoorState {
  OPEN,
  CLOSED,
  OPENING,
  CLOSING,
  STOPPED,
  VENTING,
}

export enum TargetDoorState {
  OPEN,
  CLOSED,
  VENTING = 5,
}

interface GarageState {
  door: CurrentDoorState;
  light: boolean;
}

abstract class GarageDoorOpener extends EventEmitter {
  readonly name: string;
  protected manufacturer!: string;
  protected model!: string;
  protected currentState: CurrentDoorState | null = null;
  protected targetState: TargetDoorState | null = null;
  protected lightState: boolean | null = null;

  constructor(name: string) {
    super();
    this.name = name;
  }

  public abstract getCurrentState(): CurrentDoorState;
  public abstract getTargetState(): TargetDoorState;
  public abstract setTargetState(newState: TargetDoorState): Promise<void>;
  public abstract getLightOnState(): boolean;
  public abstract setLightOnState(newState: boolean): Promise<void>;
}

export class HormannGarageDoorOpener extends GarageDoorOpener {
  logger: Debugger;
  broadcastStatus: Uint8Array;

  constructor(
    name: string = "Hörmann Garage Door",
    public hcpClient: HCPClient,
  ) {
    super(name);
    this.logger = Debug(`door:${this.name}`);
    this.manufacturer = "Hörmann";
    this.model = "Supramatic E3";
    this.broadcastStatus = new Uint8Array(2);
    this.hcpClient.on("data", this.onBroadcast.bind(this));
  }

  static targetStateToRequest(targetState: TargetDoorState): {
    flags: STATUS_RESPONSE_BYTE0_BITFIELD[];
    emergencyStop?: boolean;
  } {
    switch (targetState) {
      case TargetDoorState.OPEN: {
        return { flags: [STATUS_RESPONSE_BYTE0_BITFIELD.OPEN] };
      }
      case TargetDoorState.CLOSED: {
        return { flags: [STATUS_RESPONSE_BYTE0_BITFIELD.CLOSE] };
      }
      case TargetDoorState.VENTING: {
        return { flags: [STATUS_RESPONSE_BYTE0_BITFIELD.VENTING] };
      }
    }
  }

  static broadcastToCurrentState(status: Uint8Array): GarageState | Error {
    const bitField = SerialHCPClient.extractBitfield(status[0]);
    if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.ERROR_ACTIVE] === true) {
      return new Error("Error active");
    }
    const lightState = bitField[BROADCAST_STATUS_BYTE0_BITFIELD.LIGHT_RELAY_ON];

    if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_MOVING] === true) {
      switch (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_DIRECTION]) {
        case Boolean(DIRECTION.OPENING):
          return { door: CurrentDoorState.OPENING, light: lightState };
        case Boolean(DIRECTION.CLOSING):
          return { door: CurrentDoorState.CLOSING, light: lightState };
      }
    }
    // if not moving and no error
    if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_OPENED] === true) {
      return { door: CurrentDoorState.OPEN, light: lightState };
    } else if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_CLOSED] === true) {
      return { door: CurrentDoorState.CLOSED, light: lightState };
    } else if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_VENTING] === true) {
      return { door: CurrentDoorState.VENTING, light: lightState };
    } else {
      return new Error("Unknown status");
    }
  }

  private onBroadcast(status: Uint8Array) {
    // client 'data' callback, for each broadcast status update
    if (status[0] != this.broadcastStatus[0]) {
      // consider only byte 0 as info from byte 1 unknown
      this.broadcastStatus = status;
      const newState = HormannGarageDoorOpener.broadcastToCurrentState(status);
      if (newState instanceof Error) {
        this.emit("error", newState);
      } else {
        if (this.currentState != newState.door) {
          this.currentState = newState.door;
          this.logger(`Current door state now ${CurrentDoorState[this.currentState]}`);
          this.emit("update_door", newState.door);
        }
        if (this.lightState != newState.light) {
          this.lightState = newState.light;
          this.logger(`Current light state now ${this.lightState}`);
          this.emit("update_light", newState.light);
        }
      }
    }
  }

  public getCurrentState(): CurrentDoorState {
    if (this.currentState === null) {
      throw new Error("Current state cannot be retrieved");
    } else {
      return this.currentState;
    }
  }

  public getTargetState(): TargetDoorState {
    if (this.targetState === null) {
      throw new Error("Target state is not set");
    } else {
      return this.targetState;
    }
  }

  public setTargetState(newState: TargetDoorState): Promise<void> {
    if (this.targetState === newState) {
      this.logger(`Target state already ${TargetDoorState[this.targetState]}(${newState})`);
      return Promise.resolve();
    } else if (this.currentState === (newState as unknown as CurrentDoorState)) {
      this.logger(`Current state already ${CurrentDoorState[this.currentState]}(${newState})`);
      this.targetState = newState;
      return Promise.resolve();
    } else {
      // ask client to operate door
      const { flags, emergencyStop } = HormannGarageDoorOpener.targetStateToRequest(newState);
      return this.hcpClient.pushCommand(flags, emergencyStop).then(() => {
        this.targetState = newState;
        this.logger(`Target state set to ${TargetDoorState[this.targetState]}`);
      });
    }
  }

  public getLightOnState(): boolean {
    if (this.lightState === null) {
      throw new Error("Light state is not set");
    } else {
      return this.lightState;
    }
  }

  public setLightOnState(newState: boolean): Promise<void> {
    if (this.lightState === newState) {
      this.logger(`Light On state already ${newState}`);
      return Promise.resolve();
    } else {
      // ask client to toggle light
      return this.hcpClient
        .pushCommand([STATUS_RESPONSE_BYTE0_BITFIELD.TOGGLE_LIGHT], false)
        .then(() => {});
    }
  }
}

export function createHormannGarageDoorOpener(
  /** factory function to create a serial enabled Hormann garage door opener */
  name: string = "Hörmann Garage Door",
  { path, ...rest }: SerialOptions,
  { packetTimeout = 50, filterBreaks = true, filterMaxLength = true }: PacketFilterParams = {},
): HormannGarageDoorOpener {
  return new HormannGarageDoorOpener(
    name,
    new SerialHCPClient({ path, ...rest }, { packetTimeout, filterBreaks, filterMaxLength }),
  );
}

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
