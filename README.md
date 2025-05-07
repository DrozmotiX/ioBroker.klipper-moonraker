![Logo](admin/klipper-moonraker.png)
# ioBroker.klipper-moonraker

[![NPM version](http://img.shields.io/npm/v/iobroker.klipper-moonraker.svg)](https://www.npmjs.com/package/iobroker.klipper-moonraker)
[![Downloads](https://img.shields.io/npm/dm/iobroker.klipper-moonraker.svg)](https://www.npmjs.com/package/iobroker.klipper-moonraker)
![Number of Installations (latest)](http://iobroker.live/badges/klipper-moonraker-installed.svg)
![Number of Installations (stable)](http://iobroker.live/badges/klipper-moonraker-stable.svg)
[![Dependency Status](https://img.shields.io/david/DrozmotiX/iobroker.klipper-moonraker.svg)](https://david-dm.org/DrozmotiX/iobroker.klipper-moonraker)
[![Known Vulnerabilities](https://snyk.io/test/github/DrozmotiX/ioBroker.klipper-moonraker/badge.svg)](https://snyk.io/test/github/DrozmotiX/ioBroker.klipper-moonraker)

[![NPM](https://nodei.co/npm/iobroker.klipper-moonraker.png?downloads=true)](https://nodei.co/npm/iobroker.klipper-moonraker/)

**Tests:** ![Test and Release](https://github.com/DrozmotiX/ioBroker.klipper-moonraker/workflows/Test%20and%20Release/badge.svg)

## klipper-moonraker adapter for ioBroker

An IOBroker Adapter to interact with klipper by the Moonraker-API.

The Testclient was created with Kiauh. Kiauh is a Script that help you creating a perfect environment for your Klipper Setup.

Kiauh: 
https://github.com/th33xitus/kiauh

    
## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### __WORK IN PROGRESS__
-->

### __WORK IN PROGRESS__
* (@foxriver76) detect stale connections

### 0.1.0 (2024-04-22)
* IMPORTANT: The adapter requires Node.js 18.x+
* (foxriver76) added state to run custom GCODE commands
* (foxriver76) added possiblity to use authentication
* (foxriver76) corrected some state definitions
* (foxriver76) ported UI to json config

### 0.0.4 (2021-03-17)
* (DutchmanNL) Implemented rounding of digits
* (DutchmanNL) Transfer ownership to DrozmotiX
* (DutchmanNL) Improve automerge for dependency updates
* (Basti-RX) Update state attribute relations

### 0.0.3 (2021-01-07)
* (DutchmanNL) Switch from data-polling to live socket events :-)
* (DutchmanNL) Ensure all states and objects available are created
* (DutchmanNL) reconnect if connection closes (retry after 10 sec, ToDo : make adjustable)

### 0.0.2 (2021-01-05)
* (DutchmanNL) Implement control commands
* (DutchmanNL) Proper error handling for API calls
* (DutchmanNL) update state attributes for control commands

### 0.0.1
* (DutchmanNL) initial release

## License
MIT License

Copyright (c) 2020-2025 DutchmanNL <rdrozda@hotmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
