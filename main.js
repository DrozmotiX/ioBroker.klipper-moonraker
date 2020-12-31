'use strict';

/*
 * Created with @iobroker/create-adapter v1.31.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const {default: axios} = require('axios'); // Lib to handle http requests
const stateAttr = require('./lib/stateAttr.js'); // Load attribute library

//const WebSocketClient = require('websocket').client;
// const client = new WebSocketClient();

let polling = null; // Polling timer
let scan_timer = null; // reload = false;
let timeout = null; // Refresh delay for send state
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
		// this.on('objectChange', this.onObjectChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
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
			const printStats = await this.getAPI(`http://${this.config.klipperIP}:${this.config.klipperPort}/printer/objects/query?webhooks&virtual_sdcard&print_stats`);
			const printerInfo = await this.getAPI(`http://${this.config.klipperIP}:${this.config.klipperPort}/printer/info`);
			this.log.debug(JSON.stringify(`PrinterStats : ${JSON.stringify((printStats))}`));
			this.log.debug(JSON.stringify(`PrinterInfo : ${JSON.stringify(printerInfo)}`));
			// Create states for received data
			await this.readData(`info`, printerInfo.result);
			await this.readData(`stats`, printStats.result);

			// Set connection state to true
			this.setState('info.connection', true, true);
		}
		catch (e) {
			this.log.error(e);
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

	async readData(channel, data){

		await this.setObjectNotExistsAsync(channel, {
			type: 'channel',
			common: {
				name: channel,
			},
			native: {},
		});

		for (const state in data){
			if (typeof data[state]!== 'object') {
				this.log.debug(`type : ${typeof data[state]} | name : ${state} | value : ${data[state]}`);
				await this.create_state(`${channel}.${state}`, state, data[state]);
			} else {
				for (const state2 in data[state]){

					if (typeof data[state][state2]!== 'object') {
						this.log.debug(`type : ${typeof data[state][state2]} | name : ${state2} | value : ${data[state][state2]}`);
						await this.create_state(`${channel}.${state2}`, state2, data[state][state2]);
					} else {
						for (const state3 in data[state][state2]) {
							this.log.debug(`type : ${typeof data[state][state2][state3]} | name : ${state3} | value : ${data[state][state2][state3]}`);
							await this.create_state(`${channel}.${state3}`, state3, data[state][state2][state3]);
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
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	onUnload(callback) {
		try {
			callback();
		} catch (e) {
			this.log.error(e);
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === 'object' && obj.message) {
	// 		if (obj.command === 'send') {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info('send command');

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
	// 		}
	// 	}
	// }

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

			common.name = stateAttr[name] !== undefined ? stateAttr[name].name || name : name;
			common.type = typeof (value);
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

				await this.extendObjectAsync(stateName, {
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
				await this.setState(stateName, {
					val: value,
					ack: true,
				});
			}

			// Timer  to set online state to  FALSE when not updated during  2 time-sync intervals
			if (name === 'online') {
				// Clear running timer
				if (stateExpire[stateName]) {
					clearTimeout(stateExpire[stateName]);
					stateExpire[stateName] = null;
				}

				// timer
				stateExpire[stateName] = setTimeout(async () => {
					// Set value to state including expiration time
					await this.setState(stateName, {
						val: false,
						ack: true,
					});
					this.log.debug('Online state expired for ' + stateName);
				}, this.config.apiRefreshInterval * 2000);
				this.log.debug('Expire time set for state : ' + name + ' with time in seconds : ' + this.config.apiRefreshInterval * 2);
			}

			// Subscribe on state changes if writable
			common.write && this.subscribeStates(stateName);

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
		}else {
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