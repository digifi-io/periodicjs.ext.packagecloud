'use strict';
const pkgcloud = require('pkgcloud');
const settings = require('./settings');
let client = {};
let publicPath = {};

async function getPkgClient() {
  try {
    const extSettings = settings.getSettings();
    const containerName = extSettings.container.name;

    client = pkgcloud.storage.createClient(extSettings.client);

    switch (client.provider) {
      case 'google':
        publicPath = {
          cdnUri:  `http://storage.googleapis.com/${containerName}`,
          cdnSslUri:  `https://storage.googleapis.com/${containerName}`,
          endpoint: 'https://storage.googleapis.com',
        };
        break;
      case 'amazon':
        publicPath = {
          cdnUri: 'http://' + client.s3.config.endpoint + '/' + containerName,
          cdnSslUri: client.s3.endpoint.href + containerName,
          endpoint: client.s3.endpoint
        };
        break;
      case 'azure':
        client.before.unshift((req) => {
          if (!req.path) {
            return;
          }
    
          req.path = encodeURI(req.path);
        });

        publicPath = {
          cdnUri: `${client.protocol}${client.azureKeys.storageAccount}.${client.serversUrl}/${containerName}`,
          cdnSslUri: `https://${client.azureKeys.storageAccount}.${client.serversUrl}/${containerName}`,
          endpoint: `https://${client.azureKeys.storageAccount}.${client.serversUrl}`
        };
        break;
      default:
        throw new Error('Currently packagecloud extension supports only google/amazon/azure cloud providers');
    }

    return {
      client,
      publicPath,
      clientSettings: extSettings.client,
      containerSettings: extSettings.container,
    };
  } catch (e) {
    throw (e);
  }
}

module.exports = {
  client,
  publicPath,
  getPkgClient,
};