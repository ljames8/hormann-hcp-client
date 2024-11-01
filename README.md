Typescript client for Hörmann SupraMatic E/P Series 3 (tested on E3)  
Interface and control your Hörmann garage door to your RaspberryPi / PC with only a cheap RS485 transceiver and some RJ12 wire.

## Sources:
https://blog.bouni.de/posts/2018/hoerrmann-uap1  
https://github.com/stephan192/hoermann_door  
https://github.com/raintonr/hormann-hcp  

## Hardware interfacing
See repos above for details about RJ12 cable wiring and some RS485 compatible boards.  

### Requirements
* RS485 to TTL transceiver
* RJ12 cable with a male connector
* optionally a RS232 serial to usb transceiver

### Wiring
Hörmann drive `bus` socket <-> RJ12 cable <-> RS485 transceiver <-> {RaspberryPi UART GPIOs / RS232 transceiver <-> PC}  

## Installation
Add the npm package to your Typescript / Node.js project's dependencies
```bash
npm install --save @ljames8/hormann-hcp-client
```

## Usage

### with Hormann driver connected to serial interface
Example with "/dev/ttyUSB0" serial port
```typescript
// TODO: provide minimal example
```

### with a Mock HCP client
Use the mock client for test purposes
```typescript
import debug from "debug";
import {
  HormannGarageDoorOpener,
  TargetDoorState,
  CurrentDoorState,
  MockHCPClient
} from "@ljames8/hormann-hcp-client";

debug.enable("door:*");
const mockHCPClient = new MockHCPClient();
// set infering door states to simulate garage logic
mockHCPClient.pushCommandMock = mockHCPClient.inferPushCommandMock;
// instanciate garage door opener with mocked client
const garage = new HormannGarageDoorOpener("mock", mockHCPClient);
// sync initial garage state
mockHCPClient.emitGarageState(mockHCPClient.mockState);
// mock closing and opening successes
garage.on("update_door", (state) => {
  if (state === CurrentDoorState.OPENING) {
    setTimeout(() => mockHCPClient.emitDoorState(CurrentDoorState.OPEN), 5000);
  } else if (state === CurrentDoorState.CLOSING) {
    setTimeout(() => mockHCPClient.emitDoorState(CurrentDoorState.CLOSED), 5000);
  }
});

// try it out
garage.setTargetState(TargetDoorState.OPEN);
// and then for instance
garage.setLightOnState(true);
```
