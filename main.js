'use strict';

/*
 * Created with @iobroker/create-adapter v1.31.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const { default: axios } = require('axios'); // Lib to handle http requests
const stateAttr = require('./lib/stateAttr.js'); // Load attribute library
const WebSocket = require('ws');
let ws = null; //Global variable reserved for socket connection
let reconnectTimer = null; // Polling timer
let connectionState = null;
const stateExpire = {};
const warnMessages = {}; // Timers to reset online state of device
const disableSentry = false; // Ensure to set to true during development !
const https = require('node:https');

class KlipperMoonraker extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    constructor(options) {
        super({
            ...options,
            name: 'klipper-moonraker',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));

        /** Refresh token after X ms */
        this.REFRESH_TOKEN_MS = 50 * 60 * 1_000;
        /** Retry if login failed after X ms */
        this.RETRY_LOGIN_MS = 90_000;
        /** The one shot token for websocket auth */
        this.oneShotToken = '';
        /** The current token used for authentication */
        this.token = '';
        /** The current refresh token */
        this.refreshToken = '';
        /** Array to store state objects to avoid unneeded object changes */
        this.createdStatesDetails = {};
        /** Store all available methods to handle data calls */
        this.availableMethods = {};
        /** List of config definitions for subscription of events */
        this.subscribeMethods = {};
        /** Timeout method if no pong received in time */
        this.pingTimeout = null;
        /** Interval method to ping every X ms */
        this.pingInterval = null;

        /** Send ping every X ms */
        this.PING_INTERVAL = 30_000;
        this.axios = axios.create();
    }

    /**
     * Get the one shot token for authenticating websocket connection
     *
     * @returns {Promise<void>}
     */
    async getOneShotToken() {
        try {
            const res = await this.axios.get(`${this.getApiBaseUrl()}/access/oneshot_token`, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });

            this.oneShotToken = res.data.result;
        } catch (e) {
            throw new Error(`Could not retrieve one shot token: ${e.message}`);
        }
    }

    /**
     * Perform login with credentials from config
     *
     * @returns {Promise<void>}
     */
    async login() {
        this.log.info('Login into API');
        try {
            const res = await this.axios.post(`${this.getApiBaseUrl()}/access/login`, {
                username: this.config.user,
                password: this.config.password,
                source: 'moonraker',
            });

            this.log.info(`Successfully logged in as ${res.data.result.username}`);
            this.token = res.data.result.token;
            this.refreshToken = res.data.result.refresh_token;
        } catch (e) {
            throw new Error(`Could not login: ${e.message}`);
        }
    }

    /**
     * Configure axios according to the instance config
     */
    configureAxios() {
        if (!this.config.useSsl) {
            return;
        }

        this.axios = axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.configureAxios();
        return this.init();
    }

    /**
     * Refresh the access token
     *
     * @returns {Promise<void>}
     */
    async refreshAccessToken() {
        try {
            const res = await this.axios.post(`${this.getApiBaseUrl()}/access/refresh_jwt`, {
                refresh_token: this.refreshToken,
            });

            this.token = res.data.result.token;
        } catch (e) {
            throw new Error(`Could not refresh access token: ${e.message}`);
        }
    }

    /**
     * Start the authorization procedure
     * Login, getting one shot token and refreshing regularly
     *
     * @returns {Promise<void>}
     */
    async startAuthorization() {
        await this.login();
        await this.getOneShotToken();

        this.setInterval(() => {
            this.log.info('Refresh access token');
            try {
                this.refreshAccessToken();
                this.log.info('Access token successfully refreshed');
            } catch (e) {
                this.log.error(`Could not refresh access token: ${e.message}`);
                // we need to login from scratch, restart instance to achieve this
                this.log.error('Restarting instance');
                this.restart();
            }
        }, this.REFRESH_TOKEN_MS);
    }

    /**
     * Executes the initial adapter logic
     *
     * @returns {Promise<void>}
     */
    async init() {
        if (this.config.auth) {
            try {
                await this.startAuthorization();
            } catch (e) {
                this.log.error(e.message);

                this.log.info(`Will try again in ${this.RETRY_LOGIN_MS / 1_000} seconds`);
                this.setTimeout(() => this.init(), this.RETRY_LOGIN_MS);
                return;
            }
        }

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);
        return this.handleWebSocket();
    }

    /**
     * Handle all websocket related data interaction
     */
    async handleWebSocket() {
        let wsUrl = `${this.config.useSsl ? 'wss' : 'ws'}://${this.config.klipperIP}:${this.config.klipperPort}/websocket`;
        if (this.config.auth) {
            wsUrl += `?token=${this.oneShotToken}`;
        }

        const heartbeat = () => {
            this.clearTimeout(this.pingTimeout);

            this.pingTimeout = setTimeout(() => {
                ws.terminate();
            }, this.PING_INTERVAL + 5_000);
        };

        ws.on('pong', heartbeat);

        // Open socket connection
        ws = new WebSocket(wsUrl, {
            rejectUnauthorized: !this.config.useSsl,
        });

        // Connection successfully open, handle routine to initiates all objects and states
        ws.on('open', () => {
            this.log.info(`Successfully connected to ${this.config.klipperIP}:${this.config.klipperPort}`);
            this.setState('info.connection', true, true);
            connectionState = true;

            // Get printer basic information
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'printer.info',
                    id: 'printer.info',
                }),
            );

            // Get active spool
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'server.spoolman.get_spool_id',
                    id: 'printer.spoolID',
                }),
            );

            this.pingInterval = this.setInterval(() => {
                ws.ping();
            }, this.PING_INTERVAL);

            // Call update for all methods
            this.getAvailableMethods();
        });

        // Handle messages received from socket connection
        ws.on('message', async data => {
            const errorOutput = data => {
                this.log.warn(`Unexpected message received ${JSON.stringify(data)}`);
            };

            const rpc_data = JSON.parse(data);

            // Handle error message and return function
            if (rpc_data.error) {
                this.log.error(`Received error message for "${rpc_data.id}" over websocket: ${rpc_data.error.message}`);
                return;
            }

            //Handle state_message Data
            if (rpc_data.id) {
                if (rpc_data.id == `printer.info`) {
                    // await this.readData(rpc_data.result, `_info`);
                    this.TraverseJson(rpc_data.result, null, false, false);

                    // Create additional states not included in JSON-API of klipper-mooonraker but available as SET command
                    await this.create_state('control.runGcode', 'Run G-code', '');
                    await this.create_state('control.emergencyStop', 'Emergency Stop', false);
                    await this.create_state('control.printCancel', 'Cancel current printing', false);
                    await this.create_state('control.printPause', 'Pause current printing', false);
                    await this.create_state('control.printResume', 'Resume current printing', false);
                    await this.create_state('control.restartFirmware', 'Restart Firmware', false);
                    await this.create_state('control.restartHost', 'Restart Host', false);
                    await this.create_state('control.restartServer', 'Restart Server', false);
                    await this.create_state('control.systemReboot', 'Reboot the system', false);
                    await this.create_state('control.systemShutdown', 'Shutdown the system', false);
                } else if (rpc_data.id == `printer.objects.status`) {
                    this.TraverseJson(rpc_data.result.status, null, false, false);
                } else if (rpc_data.id == `printer.objects.list`) {
                    // Ensure array is empty
                    this.availableMethods.objects = {};

                    // Create array with possible object/states subscriptions
                    for (const method in rpc_data.result.objects) {
                        this.availableMethods.objects[rpc_data.result.objects[method]] = null;
                    }

                    this.log.debug(`All available methods : ${JSON.stringify(this.availableMethods.objects)}`);

                    // Request state data for all available methods
                    ws.send(
                        JSON.stringify({
                            jsonrpc: '2.0',
                            method: 'printer.objects.query',
                            params: {
                                objects: this.availableMethods.objects,
                            },
                            id: 'printer.objects.status',
                        }),
                    );

                    // Request status updates of all methods
                    this.subscribeMethods = this.availableMethods;

                    // Subscribe to all states including proper configuration
                    ws.send(
                        JSON.stringify({
                            jsonrpc: '2.0',
                            method: 'printer.objects.subscribe',
                            params: {
                                objects: this.subscribeMethods.objects,
                            },
                            id: 'printer.objects.subscribe',
                        }),
                    );
                } else if (rpc_data.id === `printer.spoolID`) {
                    this.log.info(`PrinterSpool ID message: ${JSON.stringify(rpc_data)}`);
                    // await this.create_state('spoolID', 'Shutdown the system', false);
                } else {
                    errorOutput(rpc_data);
                }
            } else if (rpc_data.method && rpc_data.method == 'notify_status_update' && rpc_data.params) {
                this.log.debug(`Status update data received ${JSON.stringify(rpc_data)}`);
                for (const methods in rpc_data.params) {
                    this.log.debug(`Status update data received ${JSON.stringify(rpc_data)}`);
                    this.TraverseJson(rpc_data.params[methods], null, false, false);
                }
            } else {
                errorOutput(rpc_data);
            }
        });

        // Handle closure of socket connection, try to connect again in 10seconds (if adapter enabled)
        ws.on('close', () => {
            this.clearTimeout(this.pingTimeout);
            this.clearInterval(this.pingInterval);

            this.log.info(`Connection closed`);
            this.setState('info.connection', false, true);
            connectionState = false;

            // Try to reconnect if connections is closed after 10 seconds
            if (reconnectTimer) {
                this.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            reconnectTimer = this.setTimeout(() => {
                this.log.info(`Trying to reconnect`);
                if (this.config.auth) {
                    try {
                        this.getOneShotToken();
                    } catch (e) {
                        this.log.error(e.message);
                    }
                }
                this.handleWebSocket();
            }, 10_000);
        });

        // Handle errors on socket connection
        ws.on('error', error => {
            this.log.error(`Connection error: ${error}`);
            this.setState('info.connection', false, true);
            connectionState = false;
        });
    }

    /**
     * Query all available method endpoints, socket will reply with data which initialises all available states and objects
     */
    getAvailableMethods() {
        if (connectionState) {
            // Printer Object list
            ws.send(
                JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'printer.objects.list',
                    id: 'printer.objects.list',
                }),
            );
        } else {
            this.log.error(`No active connection, cannot run 'getAvailableMethods'`);
        }
    }

    /**
     * Get the API base url based on the configuration
     *
     * @returns {string}
     */
    getApiBaseUrl() {
        return `${this.config.useSsl ? 'https' : 'http'}://${this.config.klipperIP}:${this.config.klipperPort}`;
    }

    async postAPI(endpoint) {
        this.log.debug(`Post API called for: ${endpoint}`);
        const headers = {};

        if (this.config.auth) {
            headers.Authorization = `Bearer ${this.token}`;
        }

        try {
            if (!endpoint) {
                return;
            }
            endpoint = `${this.getApiBaseUrl()}${endpoint}`;
            const result = this.axios
                .post(endpoint, null, { headers })
                .then(response => {
                    this.log.debug(`Sending command to Klippy API: ${endpoint}`);
                    return response.data;
                })
                .catch(error => {
                    this.log.debug(`Sending command to Klippy API: ${endpoint} failed with error ${error}`);
                    return error;
                });
            return result;
        } catch (e) {
            this.log.error(`Issue in postAPI: ${e.message}`);
        }
    }

    /**
     * Traverses the json-object and provides all information for creating/updating states
     *
     * @param {object} o Json-object to be added as states
     * @param {string | null} parent Defines the parent object in the state tree
     * @param {boolean} replaceName Steers if name from child should be used as name for structure element (channel)
     * @param {boolean} replaceID Steers if ID from child should be used as ID for structure element (channel)
     */
    async TraverseJson(o, parent = null, replaceName = false, replaceID = false) {
        let id = null;
        let value = null;
        let name = null;

        try {
            for (const i in o) {
                name = i;
                if (!!o[i] && typeof o[i] == 'object' && o[i] == '[object Object]') {
                    if (parent == null) {
                        id = i;
                        if (replaceName) {
                            if (o[i].name) {
                                name = o[i].name;
                            }
                        }
                        if (replaceID) {
                            if (o[i].id) {
                                id = o[i].id;
                            }
                        }
                    } else {
                        id = `${parent}.${i}`;
                        if (replaceName) {
                            if (o[i].name) {
                                name = o[i].name;
                            }
                        }
                        if (replaceID) {
                            if (o[i].id) {
                                id = `${parent}.${o[i].id}`;
                            }
                        }
                    }
                    // Avoid channel creation for empty arrays/objects
                    if (Object.keys(o[i]).length !== 0) {
                        await this.setObjectAsync(id, {
                            type: 'channel',
                            common: {
                                name: name,
                            },
                            native: {},
                        });
                        this.TraverseJson(o[i], id, replaceName, replaceID);
                    } else {
                        this.log.debug(`State ${id} received with empty array, ignore channel creation`);
                    }
                } else {
                    value = o[i];
                    if (parent == null) {
                        id = i;
                    } else {
                        id = `${parent}.${i}`;
                    }
                    if (typeof o[i] == 'object') {
                        value = JSON.stringify(value);
                    }
                    this.log.debug(`create id ${id} with value ${value} and name ${name}`);

                    this.create_state(id, name, value);
                }
            }
        } catch (error) {
            this.log.error(`Error in function TraverseJson: ${error}`);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback
     */
    onUnload(callback) {
        try {
            // Cancel reconnect timer if running
            if (reconnectTimer) {
                this.clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            // Close socket connection
            if (ws) {
                ws.close();
            }
            callback();
        } catch (e) {
            this.log.error(e);
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        //Only execute when ACK = false
        if (!state || state.ack) {
            return;
        }

        // Split state name in segments to be used later
        const deviceId = id.split('.');
        // If state us related to control commands, customize API post call
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
            case 'runGcode':
                apiResult = await this.postAPI(`/printer/gcode/script?script=${state.val}`);
                break;
        }
        if (apiResult) {
            if (apiResult.result === 'ok') {
                this.log.info(`Command "${deviceId[3]}" send successfully`);
            } else {
                this.log.error(
                    `Sending command "${deviceId[3]}" failed, error  : ${JSON.stringify(apiResult.message)}`,
                );
            }
        }
    }

    /**
     * @param stateName {string} ID of the state
     * @param name {string} Name of state (also used for stattAttrlib!)
     * @param value {boolean | string | null} Value of the state
     */
    async create_state(stateName, name, value) {
        this.log.debug(`Create_state called for : ${stateName} with value : ${value}`);

        /**
         * Value rounding 1 digits
         *
         * @param {number} [value] - Number to round with . separator
         *  @param {object} [adapter] - intance "this" object
         */
        function rondOneDigit(value, adapter) {
            try {
                let rounded = Number(value);
                rounded = Math.round(rounded * 100) / 100;
                adapter.log.debug(`roundCosts with ${value} rounded ${rounded}`);
                if (!rounded) {
                    return value;
                }
                return rounded;
            } catch (error) {
                adapter.log.error(`[roundCosts ${value}`);
                adapter.sendSentry(error);
            }
        }
        /**
         * Value rounding 2 digits
         *
         * @param {number} [value] - Number to round with , separator
         * @param {object} [adapter] - instance "this" object
         */
        function roundTwoDigits(value, adapter) {
            let rounded;
            try {
                rounded = Number(value);
                rounded = Math.round(rounded * 1000) / 1000;
                adapter.log.debug(`roundDigits with ${value} rounded ${rounded}`);
                if (!rounded) {
                    return value;
                }
                return rounded;
            } catch (error) {
                adapter.log.error(`[roundDigits ${value}`);
                adapter.sendSentry(error);
                rounded = value;
                return rounded;
            }
        }
        /**
         * Value rounding 3 digits
         *
         * @param {number} [value] - Number to round with , separator
         * @param {object} [adapter] - intance "this" object
         */
        function roundThreeDigits(value, adapter) {
            let rounded;
            try {
                rounded = Number(value);
                rounded = Math.round(rounded * 1000) / 1000;
                adapter.log.debug(`roundDigits with ${value} rounded ${rounded}`);
                if (!rounded) {
                    return value;
                }
                return rounded;
            } catch (error) {
                adapter.log.error(`[roundDigits ${value}`);
                adapter.sendSentry(error);
                rounded = value;
                return rounded;
            }
        }

        try {
            // Try to get details from state lib, if not use defaults. throw warning is states is not known in attribute list
            const common = {};
            if (!stateAttr[name]) {
                const warnMessage = `State attribute definition missing for "${name}" (received value ${value} - ${typeof value})`;
                if (warnMessages[name] !== warnMessage) {
                    warnMessages[name] = warnMessage;
                    // Send information to Sentry
                    this.sendSentry(warnMessage);
                }
            }
            let createStateName = stateName;

            // Todo: Disable stateAttr based channel creation
            // const channel = stateAttr[name] !== undefined ? stateAttr[name].root || '' : '';
            const channel = '';
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
            common.type = stateAttr[name] !== undefined ? stateAttr[name].type || typeof value : typeof value;
            common.role = stateAttr[name] !== undefined ? stateAttr[name].role || 'state' : 'state';
            common.read = true;
            common.unit = stateAttr[name] !== undefined ? stateAttr[name].unit || '' : '';
            common.write = stateAttr[name] !== undefined ? stateAttr[name].write || false : false;

            if (
                !this.createdStatesDetails[stateName] ||
                (this.createdStatesDetails[stateName] &&
                    (common.name !== this.createdStatesDetails[stateName].name ||
                        common.name !== this.createdStatesDetails[stateName].name ||
                        common.type !== this.createdStatesDetails[stateName].type ||
                        common.role !== this.createdStatesDetails[stateName].role ||
                        common.read !== this.createdStatesDetails[stateName].read ||
                        common.unit !== this.createdStatesDetails[stateName].unit ||
                        common.write !== this.createdStatesDetails[stateName].write))
            ) {
                await this.extendObjectAsync(createStateName, {
                    type: 'state',
                    common,
                });
            }

            // Store current object definition to memory
            this.createdStatesDetails[stateName] = common;

            // Check if value should be rounded, active switch
            const roundingOneDigit = stateAttr[name] !== undefined ? stateAttr[name].round_1 || false : false;
            const roundingTwoDigits = stateAttr[name] !== undefined ? stateAttr[name].round_2 || false : false;
            const roundingThreeDigits = stateAttr[name] !== undefined ? stateAttr[name].round_3 || false : false;

            // Set value to state including expiration time
            if (value !== null && value !== undefined) {
                // Check if value should be rounded, if yes execute
                if (typeof value == 'number' || typeof value == 'string') {
                    if (roundingOneDigit) {
                        value = rondOneDigit(value, this);
                    } else if (roundingTwoDigits) {
                        value = roundTwoDigits(value, this);
                    } else if (roundingThreeDigits) {
                        value = roundThreeDigits(value, this);
                    }
                }
                await this.setStateChangedAsync(createStateName, {
                    val: value,
                    ack: true,
                });
            }

            // Timer  to set online state to  FALSE when not updated during  2 time-sync intervals
            if (name === 'klippy connected') {
                // Clear running timer
                if (stateExpire[stateName]) {
                    this.clearTimeout(stateExpire[createStateName]);
                    stateExpire[stateName] = null;
                }

                // timer
                stateExpire[stateName] = this.setTimeout(async () => {
                    // Set value to state including expiration time
                    await this.setState(createStateName, {
                        val: false,
                        ack: true,
                    });
                    this.log.debug(`Online state expired for ${stateName}`);
                }, this.config.apiRefreshInterval * 2_000);
                this.log.debug(
                    `Expire time set for state : ${name} with time in seconds : ${this.config.apiRefreshInterval * 2}`,
                );
            }

            // Subscribe on state changes if writable
            common.write && this.subscribeStates(createStateName);
        } catch (error) {
            this.log.error(`Create state error = ${error}`);
        }
    }

    /**
     * Send error's to sentry, only if sentry not disabled
     *
     * @param {string} msg ID of the state
     */
    sendSentry(msg) {
        if (!disableSentry) {
            if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
                const sentryInstance = this.getPluginInstance('sentry');
                if (sentryInstance) {
                    this.log.info(`[Error caught and sent to Sentry, thank you for collaborating!] error: ${msg}`);
                    sentryInstance.getSentryObject().captureException(msg);
                }
            }
        } else {
            this.log.error(`Sentry disabled, error caught: ${msg}`);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    module.exports = options => new KlipperMoonraker(options);
} else {
    // otherwise start the instance directly
    new KlipperMoonraker();
}
