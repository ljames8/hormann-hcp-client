import { EventEmitter } from "events";

import Debug, { Debugger } from "debug";

import {
  SerialHCPClient,
  SerialOptions,
  STATUS_RESPONSE_BYTE0_BITFIELD,
  BROADCAST_STATUS_BYTE0_BITFIELD,
  DIRECTION,
} from "./serialHCPClient";
import { PacketFilterParams } from "./parser";

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

abstract class GarageDoorOpener extends EventEmitter {
  protected name: string;
  protected manufacturer!: string;
  protected model!: string;
  protected currentState: CurrentDoorState | null;
  protected targetState: TargetDoorState | null;

  constructor(name: string) {
    super();
    this.name = name;
    this.currentState = null;
    this.targetState = null;
  }

  public abstract getCurrentState(): CurrentDoorState;
  public abstract getTargetState(): TargetDoorState;
  public abstract setTargetState(newState: TargetDoorState): Promise<void>;
}

export class HormannGarageDoorOpener extends GarageDoorOpener {
  hcpClient: SerialHCPClient;
  logger: Debugger;
  broadcastStatus: Uint8Array;

  constructor(
    name: string = "Hörmann Garage Door",
    { path, ...rest }: SerialOptions,
    { packetTimeout = 50, filterBreaks = true, filterMaxLength = true }: PacketFilterParams = {},
  ) {
    super(name);
    this.logger = Debug(`door:${this.name}`);
    this.manufacturer = "Hörmann";
    this.model = "Supramatic E3";
    this.broadcastStatus = new Uint8Array(2);
    this.hcpClient = new SerialHCPClient(
      { path, ...rest },
      { packetTimeout, filterBreaks, filterMaxLength },
    );
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

  static broadcastToCurrentState(status: Uint8Array): CurrentDoorState | Error {
    const bitField = SerialHCPClient.extractBitfield(status[0]);
    if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.ERROR_ACTIVE] === true) {
      return new Error("Error active");
    }
    if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_MOVING] === true) {
      switch (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_DIRECTION]) {
        case Boolean(DIRECTION.OPENING):
          return CurrentDoorState.OPENING;
        case Boolean(DIRECTION.CLOSING):
          return CurrentDoorState.CLOSING;
      }
    }
    // if not moving and no error
    if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_OPENED] === true) {
      return CurrentDoorState.OPEN;
    } else if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_CLOSED] === true) {
      return CurrentDoorState.CLOSED;
    } else if (bitField[BROADCAST_STATUS_BYTE0_BITFIELD.DOOR_VENTING] === true) {
      return CurrentDoorState.VENTING;
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
        this.currentState = newState;
        this.logger(`Current state now ${CurrentDoorState[this.currentState]}`);
        this.emit("update", newState);
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
}
