import {
  AccessoryConfig,
  AccessoryPlugin,
  CharacteristicValue,
  API,
  HAP,
  Logging,
  Service,
} from "homebridge";
import {ACCESSORY_NAME, PLUGIN_NAME} from './settings';

let hap: HAP;
/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  api.registerAccessory(PLUGIN_NAME, ACCESSORY_NAME, GarageDoorOpenerAccessory);
};

class GarageDoorOpenerAccessory implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly name: string;

  private readonly service: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;

    // create a new Garage Door Opener service
    this.service = new hap.Service.GarageDoorOpener(this.name);

    // create handlers for required characteristics
    this.service
      .getCharacteristic(hap.Characteristic.CurrentDoorState)
      .onGet(this.handleCurrentDoorStateGet.bind(this));

    this.service
      .getCharacteristic(hap.Characteristic.TargetDoorState)
      .onGet(this.handleTargetDoorStateGet.bind(this))
      .onSet(this.handleTargetDoorStateSet.bind(this));

    this.service
      .getCharacteristic(hap.Characteristic.ObstructionDetected)
      .onGet(this.handleObstructionDetectedGet.bind(this));
  }

  getServices() {
    return [
      // this.informationService,
      this.service,
    ];
  }
  /**
   * Handle requests to get the current value of the "Current Door State" characteristic
   */
  handleCurrentDoorStateGet() {
    this.log.debug("Triggered GET CurrentDoorState");

    // set this to a valid value for CurrentDoorState
    const currentValue = hap.Characteristic.CurrentDoorState.OPEN;

    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Target Door State" characteristic
   */
  handleTargetDoorStateGet() {
    this.log.debug("Triggered GET TargetDoorState");

    // set this to a valid value for TargetDoorState
    const currentValue = hap.Characteristic.TargetDoorState.OPEN;

    return currentValue;
  }

  /**
   * Handle requests to set the "Target Door State" characteristic
   */
  handleTargetDoorStateSet(value: CharacteristicValue) {
    this.log.debug("Triggered SET TargetDoorState:", value);
  }

  /**
   * Handle requests to get the current value of the "Obstruction Detected" characteristic
   */
  handleObstructionDetectedGet() {
    this.log.debug("Triggered GET ObstructionDetected");

    // set this to a valid value for ObstructionDetected
    const currentValue = 1;

    return currentValue;
  }
}