'use strict';
const periodic = require('periodicjs');

function getSettings() {
  return periodic.settings.extensions['@digifi/periodicjs.ext.packagecloud'];
}

module.exports = {
  getSettings,
};