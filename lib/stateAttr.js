// Classification of all state attributes possible
const stateAttrb = {
	// State object
	'mA': {
		name: 'Current LED power usage in milliamps as determined by the ABL. 0 if ABL is disabled',
		type: 'number',
		read: true,
		write: false,
		role: 'value.current',
		unit: 'mA'
	},
	'total_duration': {
		name: 'total_duration',
		type: 'date',
		read: true,
		write: false,
		role: 'value.time',
	},
};

module.exports = stateAttrb;