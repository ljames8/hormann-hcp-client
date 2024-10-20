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
npm install --save hormann-hcp-client
```

## Usage
```typescript
// TODO: provide minimal example
```