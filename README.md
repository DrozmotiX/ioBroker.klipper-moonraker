# ioBroker.klipper-moonraker

![Number of Installations](https://iobroker.live/badges/klipper-moonraker-installed.svg)
![Stable version](https://iobroker.live/badges/klipper-moonraker-stable.svg)
![NPM version](https://img.shields.io/npm/v/iobroker.klipper-moonraker.svg)
![Downloads](https://img.shields.io/npm/dm/iobroker.klipper-moonraker.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/github/license/DrozmotiX/ioBroker.klipper-moonraker)

ioBroker adapter to interact with **Klipper** via the **Moonraker API**

This adapter allows integration of **Klipper based 3D printers** into **ioBroker** using the Moonraker API.

---

## Table of contents

- Overview
- Features
- Requirements
- Configuration
- Data points
- Example object structure
- Troubleshooting
- Development
- License

---

## Overview

This adapter connects ioBroker with a **Klipper based 3D printer** via the **Moonraker API**.

Moonraker acts as the communication interface between Klipper and external systems.

---

## Features

- Connection to Moonraker API
- Access to Klipper printer objects
- Automatic state creation
- Access to printer telemetry
- Integration into ioBroker automation

---

## Requirements

- Node.js ≥ 18
- ioBroker
- Klipper
- Moonraker API

---

## Configuration

| Setting | Example |
|--------|--------|
| Host   | 192.168.1.100 |
| Port   | 7125 |
| Protocol | http |

Test:
http://PRINTER-IP:7125/server/info

---

## Data points

All states are created under:

klipper-moonraker.0

---

## Example object structure

klipper-moonraker.0.adc_current_sensor.current
klipper-moonraker.0.auto_screws_tilt_adjust.adjust_tolerance
klipper-moonraker.0.bed_mesh.mesh_matrix

---

## Troubleshooting

Check Moonraker:
http://PRINTER-IP:7125/server/info

Check logs:
iobroker logs

---

## Development

https://github.com/DrozmotiX/ioBroker.klipper-moonraker

---

## License

MIT License
