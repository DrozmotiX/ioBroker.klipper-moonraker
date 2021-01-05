'use strict';

/*
 * Created with @iobroker/create-adapter v1.31.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const {default: axios} = require('axios'); // Lib to handle http requests
const stateAttr = require('./lib/stateAttr.js'); // Load attribute library


let polling = null; // Polling timer
// let scan_timer = null; // reload = false;
// let timeout = null; // Refresh delay for send state
const stateExpire = {}, warnMessages = {}; // Timers to reset online state of device
const disableSentry = false; // Ensure to set to true during development !


class KlipperMoonraker extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'klipper-moonraker',
		});

		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('unload', this.onUnload.bind(this));

		// Array for created states
		this.createdStatesDetails = {};
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {

		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);
		//start polling
		await this.polling_timer();
	}

	async polling_timer() {

		// get basic info
		try {
			// Load data from Klipper API
			let apiError =  null;
			const printStats = await this.getAPI(`http://${this.config.klipperIP}:${this.config.klipperPort}/printer/objects/query?webhooks&virtual_sdcard&print_stats`);
			const printerInfo = await this.getAPI(`http://${this.config.klipperIP}:${this.config.klipperPort}/printer/info`);
			const serverInfo = await this.getAPI(`http://${this.config.klipperIP}:${this.config.klipperPort}/server/info`);
			// const endstops = await this.getAPI(`http://${this.config.klipperIP}:${this.config.klipperPort}/printer/query_endstops/status`);
			// const printerObjectList = await this.getAPI(`http://${this.config.klipperIP}:${this.config.klipperPort}/printer/objects/list`);

			this.log.debug(JSON.stringify(`PrinterStats : ${JSON.stringify((printStats))}`));
			this.log.debug(JSON.stringify(`PrinterInfo : ${JSON.stringify(printerInfo)}`));
			this.log.debug(JSON.stringify(`ServerInfo : ${JSON.stringify(serverInfo)}`));
			// this.log.debug(JSON.stringify(`ServerInfo : ${JSON.stringify(endstops)}`));
			// this.log.debug(JSON.stringify(`PrinterInfo : ${JSON.stringify(printerObjectList)}`));

			// Create states for received data
			if (printerInfo && printerInfo.result) {
				await this.readData(printerInfo.result);
			} else {
				apiError =  true;
				this.log.error(`Cannot get data for printerInfo`);
			}
			if (printStats && printStats.result) {
				await this.readData(printStats.result);
			} else {
				apiError = true;
				this.log.error(`Cannot get data for printStats`);
			}
			if (serverInfo && serverInfo.result) {
				await this.readData(serverInfo.result);
			} else {
				apiError =  true;
				this.log.error(`Cannot get data for serverInfo`);
			}
			// await this.readData(endstops.result);
			// await this.readData(printerObjectList.result);

			// Set connection state to true
			if (!apiError === true){
				this.setState('info.connection', true, true);
			}
			// Create additional states not included in JSON-API of klipper-mooonraker but available as SET command
			await this.create_state('emergencyStop', 'Emergency Stop');
			await this.create_state('printCancel', 'Cancel current printing');
			await this.create_state('printPause', 'Pause current printing');
			await this.create_state('printResume', 'Resume current printing');
			await this.create_state('restartFirmware', 'Restart Firmware');
			await this.create_state('restartHost', 'Restart Host');
			await this.create_state('restartServer', 'Restart Server');
			await this.create_state('systemReboot', 'Reboot the system');
			await this.create_state('systemShutdown', 'Shutdown the system');
			//ToDo: Unclear how to handle this state
			// await this.create_state('runGCODE', 'Run gcode', false);
		} catch (e) {
			this.log.error(`Issue in data-polling ${e}`);
			// Set connection state to false
			this.setState('info.connection', false, true);
		}

		// start polling interval
		if (polling) {
			clearTimeout(polling);
			polling = null;
		}
		polling = setTimeout(() => {
			this.polling_timer();
		}, (this.config.apiRefreshInterval * 1000));

	}

	async readData(data) {
		for (const state in data) {
			if (typeof data[state] !== 'object') {
				this.log.debug(`type : ${typeof data[state]} | name : ${state} | value : ${data[state]}`);
				await this.create_state(`${state}`, state, data[state]);
			} else {
				if (state == 'plugins') {
					await this.create_state(`${state}`, state, data[state]);
				} else {
					for (const state2 in data[state]) {
						if (typeof data[state][state2] !== 'object') {
							this.log.debug(`type : ${typeof data[state][state2]} | name : ${state2} | value : ${data[state][state2]}`);
							await this.create_state(`${state2}`, state2, data[state][state2]);
						} else {
							for (const state3 in data[state][state2]) {
								this.log.debug(`type : ${typeof data[state][state2][state3]} | name : ${state3} | value : ${data[state][state2][state3]}`);
								await this.create_state(`${state3}`, state3, data[state][state2][state3]);
							}
						}
					}
				}
			}
		}
	}

	async getAPI(url) {
		this.log.debug('GET API called for : ' + url);
		try {
			const response = await axios.get(url, {timeout: 3000}); // Timout of 3 seconds for API call
			this.log.debug(JSON.stringify('API response data : ' + response.data));
			return response.data;
		} catch (error) {
			this.log.debug(`Error in API call : ${error}`);
		}
	}

	/**
	 * Function to send HTTP post command
	 * @param {string} [url]- URL to handle post call, IP and port is take from adapter settings
	 */
	async postAPI(url) {
		this.log.debug(`Post API called for :  ${url}`);
		try {
			if (!url) return;
			url = `http://${this.config.klipperIP}:${this.config.klipperPort}${url}`;
			const result = axios.post(url)
				.then((response) => {
					this.log.debug(`Sending command to Klippy API : ${url}`);
					return response.data;
				})
				.catch((error) => {
					this.log.debug('Sending command to Klippy API : ' + url + ' failed with error ' + error);
					return error;
				});
			return result;
		} catch (error) {
			this.log.error(`Issue in postAPI ${error}`);
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	onUnload(callback) {
		try {
			// Cancel timer if running
			if (polling) {
				clearTimeout(polling);
				polling = null;
			}
			callback();
		} catch (e) {
			this.log.error(e);
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		//Only execute when ACK = false
		if (state && !state.ack) {

			// Split state name in segments to be used later
			const deviceId = id.split('.');
			// If state us related to control commands, customiza API post call
			if (deviceId[2] == 'control') {
				this.log.debug(`Control command received ${deviceId[3]}`);
				let apiResult = null;
				switch (deviceId[3]) {
					case 'emergencyStop':
						apiResult = await this.postAPI(`/printer/emergency_stop`);
						break;
					case 'printCancel':
						apiResult = await this.postAPI(`/printer/print/cancel`);
						break;
					case 'printPause':
						apiResult = await this.postAPI(`/printer/print/pause`);
						break;
					case 'printResume':
						apiResult = await this.postAPI(`/printer/print/resume`);
						break;
					case 'restartFirmware':
						apiResult = await this.postAPI(`/printer/firmware_restart`);
						break;
					case 'restartHost':
						apiResult = await this.postAPI(`/printer/restart`);
						break;
					case 'restartServer':
						apiResult = await this.postAPI(`/server/restart`);
						break;
					case 'systemReboot':
						apiResult = await this.postAPI(`/machine/reboot`);
						break;
					case 'systemShutdown':
						apiResult = await this.postAPI(`/machine/shutdown`);
						break;
				}
				if (apiResult) {
					if (apiResult.result == 'ok') {
						this.log.info(`Command "${deviceId[3]}" send successfully`);
					} else {
						this.log.error(`Sending command "${deviceId[3]}" failed, error  : ${JSON.stringify(apiResult.message)}`);
					}
				}
			}
		}
	}

	async create_state(stateName, name, value) {
		this.log.debug('Create_state called for : ' + stateName + ' with value : ' + value);
		try {

			// Try to get details from state lib, if not use defaults. throw warning is states is not known in attribute list
			const common = {};
			if (!stateAttr[name]) {
				const warnMessage = `State attribute definition missing for + ${name}`;
				if (warnMessages[name] !== warnMessage) {
					warnMessages[name] = warnMessage;
					// Send information to Sentry
					this.sendSentry(warnMessage);
				}
			}
			let createStateName = stateName;
			const channel = stateAttr[name] !== undefined ? stateAttr[name].root || '' : '';
			if (channel !== '') {
				await this.setObjectNotExistsAsync(channel, {
					type: 'channel',
					common: {
						name: stateAttr[name] !== undefined ? stateAttr[name].rootName || '' : '',
					},
					native: {},
				});
				createStateName = `${channel}.${stateName}`;
			}
			common.name = stateAttr[name] !== undefined ? stateAttr[name].name || name : name;
			common.type = stateAttr[name] !== undefined ? stateAttr[name].type || typeof (value) : typeof (value);
			common.role = stateAttr[name] !== undefined ? stateAttr[name].role || 'state' : 'state';
			common.read = true;
			common.unit = stateAttr[name] !== undefined ? stateAttr[name].unit || '' : '';
			common.write = stateAttr[name] !== undefined ? stateAttr[name].write || false : false;

			if ((!this.createdStatesDetails[stateName])
				|| (this.createdStatesDetails[stateName]
					&& (
						common.name !== this.createdStatesDetails[stateName].name
						|| common.name !== this.createdStatesDetails[stateName].name
						|| common.type !== this.createdStatesDetails[stateName].type
						|| common.role !== this.createdStatesDetails[stateName].role
						|| common.read !== this.createdStatesDetails[stateName].read
						|| common.unit !== this.createdStatesDetails[stateName].unit
						|| common.write !== this.createdStatesDetails[stateName].write
					)
				)) {

				// console.log(`An attribute has changed : ${state}`);

				await this.extendObjectAsync(createStateName, {
					type: 'state',
					common
				});

			} else {
				// console.log(`Nothing changed do not update object`);
			}

			// Store current object definition to memory
			this.createdStatesDetails[stateName] = common;

			// Set value to state including expiration time
			if (value !== null || value !== undefined) {
				await this.setState(createStateName, {
					val: value,
					ack: true,
				});
			}

			// Timer  to set online state to  FALSE when not updated during  2 time-sync intervals
			if (name === 'klippy connected') {
				// Clear running timer
				if (stateExpire[stateName]) {
					clearTimeout(stateExpire[createStateName]);
					stateExpire[stateName] = null;
				}

				// timer
				stateExpire[stateName] = setTimeout(async () => {
					// Set value to state including expiration time
					await this.setState(createStateName, {
						val: false,
						ack: true,
					});
					this.log.debug('Online state expired for ' + stateName);
				}, this.config.apiRefreshInterval * 2000);
				this.log.debug('Expire time set for state : ' + name + ' with time in seconds : ' + this.config.apiRefreshInterval * 2);
			}

			// Subscribe on state changes if writable
			common.write && this.subscribeStates(createStateName);

		} catch (error) {
			this.log.error('Create state error = ' + error);
		}
	}

	sendSentry(msg) {

		if (!disableSentry) {
			this.log.info(`[Error catched and send to Sentry, thank you collaborating!] error: ${msg}`);
			if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
				const sentryInstance = this.getPluginInstance('sentry');
				if (sentryInstance) {
					sentryInstance.getSentryObject().captureException(msg);
				}
			}
		} else {
			this.log.error(`Sentry disabled, error catched : ${msg}`);
			console.error(`Sentry disabled, error catched : ${msg}`);
		}
	}

}

// @ts-ignore parent is a valid property on module
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new KlipperMoonraker(options);
} else {
	// otherwise start the instance directly
	new KlipperMoonraker();
}