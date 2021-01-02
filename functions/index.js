const admin = require('firebase-admin');
admin.initializeApp();

module.exports.auth = require('./src');
