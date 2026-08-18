const { db } = require('../../db.js');
const provider = require('./provider.js');
const { createService } = require('./service.js');

module.exports = { createService, service: createService({ db, provider: provider.official }) };
