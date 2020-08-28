'use strict';
const periodic = require('periodicjs');
const Busboy = require('busboy');
const crypto = require('crypto');
const moment = require('moment');
const fs = require('fs-extra');
const path = require('path');
const mime = require('mime');

function pkgCloudUploadDirectory(options) {
  const { req, upload_dir, include_timestamp_in_dir, } = options;
  const current_date = moment().format('YYYY/MM/DD');
  const upload_path_dir = (req.localuploadpath) ?
    req.localuploadpath :
    path.join(upload_dir, (include_timestamp_in_dir) ? current_date : '');

  return {
    current_date,
    upload_dir,
    upload_path_dir,
    periodicDir: path.join(upload_dir, (include_timestamp_in_dir) ? current_date : ''),
  };
}


/**
 * handles file data from a multi-part form
 * 
 * @param {any} fieldname 
 * @param {any} file 
 * @param {any} filename 
 * @param {any} encoding 
 * @param {any} mimetype 
 */
function pkgCloudFormFileHandler(fieldname, file, filename, encoding, mimetype) {
  const fieldHandler = periodic.core.files.formFieldHandler.bind(this);
  const pkgCloudClient = this.pkgcloud_client;
  const upload_dir = this.upload_directory || 'clouduploads';
  const name = periodic.core.files.renameFile.call(this, {
    filename,
    req: this.req,
  });
  const uploadDir = pkgCloudUploadDirectory({
    req: this.req,
    periodic: this.periodic,
    upload_dir,
    include_timestamp_in_dir: (typeof this.include_timestamp_in_dir === 'boolean') ? this.include_timestamp_in_dir : true,
  });
  const pkgCloudUploadFileName = path.join(this.upload_path_dir || uploadDir.upload_path_dir, name);
  const pkgCloudRemoteBaseURL = (this.prefer_http) ? pkgCloudClient.publicPath.cdnUri : pkgCloudClient.publicPath.cdnSslUri + '/';
  const filelocation = pkgCloudRemoteBaseURL + pkgCloudUploadFileName;
  const fileurl = filelocation;
  const processedFile = {
    fieldname,
    encoding,
    mimetype,
    locationtype: pkgCloudClient.clientSettings.provider,
    original_filename: filename,
    filename: name,
    name,
    size: 0,
    fileurl,
    location: filelocation,
    uploaddirectory: uploadDir.periodicDir,
    encrypted_client_side: this.encrypted_client_side,
    client_encryption_algo: this.client_encryption_algo,
    attributes: Object.assign({}, pkgCloudClient.publicPath, {
      cloudfilepath: pkgCloudUploadFileName,
      cloudcontainername: pkgCloudClient.containerSettings.name,
      location: filelocation,
    }),
  };

  if (this.save_to_disk) {
    const uploadStream = pkgCloudClient.client.upload({
      container: pkgCloudClient.containerSettings.name,
      remote: pkgCloudUploadFileName,
    });
    uploadStream.on('error', (e) => {
      throw e;
    });

    uploadStream.on('success', (cloudfile) => {
      this.cloudfiles.push(cloudfile);
      if (this.cloudfiles.length === this.files.length && this.completedFormProcessing === false && this.wait_for_cloud_uploads === true) {
        this.completeHandler();
        this.completedFormProcessing = true;
      }
    });

    if (this.encrypted_client_side) {
      const cipher = crypto.createCipher(this.client_encryption_algo, this.encryption_key);
      file
        .pipe(cipher)
        .pipe(uploadStream);
    } else {
      file.pipe(uploadStream);
    }
  }
  file.on('data', (chunk) => {
    processedFile.size += this.use_buffers ? Buffer.byteLength(chunk) : chunk.length;
  });
  file.on('end', () => {
    this.files.push(processedFile);
    if (this.cloudfiles.length === this.files.length && this.completedFormProcessing === false && this.wait_for_cloud_uploads === true) {
      this.completeHandler();
      this.completedFormProcessing = true;
    }
  });
  file.on('error', (e) => {
    throw e;
  });


  fieldHandler(fieldname, filename);
}

async function pkgCloudUploadFile({ fieldname = 'upload_file', renameOptions = { 'exclude-userstamp':true}, uploadDirectoryOptions = {}, user = {}, file, filename, encoding = 'binary', mimetype, include_asset_body, fileBody = {}, }) {
  filename = !filename ? path.parse(file).base : filename;
  mimetype = mimetype || mime.lookup(filename);
  const periodic= this.periodic;
  const pkgCloudClient = this.pkgcloud_client;
  const upload_dir = this.upload_directory || 'clouduploads';
  const name = periodic.core.files.renameFile.call(this, {
    filename,
    req: {
      body: renameOptions,
      user,
    },
  });
  const uploadDir = pkgCloudUploadDirectory({
    req:  uploadDirectoryOptions,
    upload_dir,
    periodic,
    include_timestamp_in_dir: (typeof this.include_timestamp_in_dir === 'boolean') ? this.include_timestamp_in_dir : true,
  });
  const pkgCloudUploadFileName = path.join(this.upload_path_dir || uploadDir.upload_path_dir, name);
  const pkgCloudRemoteBaseURL = (this.prefer_http) ? pkgCloudClient.publicPath.cdnUri : pkgCloudClient.publicPath.cdnSslUri + '/';
  const filelocation = pkgCloudRemoteBaseURL + pkgCloudUploadFileName;
  const fileurl = filelocation;
  const processedFile = {
    fieldname,
    encoding,
    mimetype: mimetype || mime.lookup(filename),
    locationtype: pkgCloudClient.clientSettings.provider,
    original_filename: filename,
    filename: name,
    name,
    size: 0,
    fileurl,
    location: filelocation,
    uploaddirectory: uploadDir.periodicDir,
    encrypted_client_side: this.encrypted_client_side,
    client_encryption_algo: this.client_encryption_algo,
    attributes: Object.assign({}, pkgCloudClient.publicPath, {
      cloudfilepath: pkgCloudUploadFileName,
      cloudcontainername: pkgCloudClient.containerSettings.name,
      location: filelocation,
    }),
  };

  file = typeof file === 'string' ? fs.createReadStream(path.resolve(file)) : file;
  
  return new Promise((resolve, reject) => {
    try {
      file.on('data', (chunk) => {
        processedFile.size += this.use_buffers ? Buffer.byteLength(chunk) : chunk.length;
      });
      file.on('end', async () => {
        const files = [ processedFile ];
        const newassets = files.map(file => periodic.core.files.generateAssetFromFile({
          include_asset_body,
          req: { body: fileBody },
          periodic,
          file,
        }));
        if (this.save_file_to_asset) {
          const assetDBName = this.asset_core_data || this.periodic.settings.express.config.asset_core_data;
          const assetDB = this.periodic.datas.get(assetDBName);
          const newdoc = (this.pre_asset_create_map)
            ? newassets.map(this.pre_asset_create_map({ req, res, periodic }))
            : newassets;
          const newassetdocs = await assetDB.create({
            bulk_create: true,
            newdoc,
          });
          resolve(newassetdocs[ 0 ]);
        } else {
          resolve(processedFile);
        }
      });
      file.on('error', reject);
      if (this.save_to_disk) {
        const uploadStream = pkgCloudClient.client.upload({
          container: pkgCloudClient.containerSettings.name,
          remote: pkgCloudUploadFileName,
        });
        uploadStream.on('error', (e) => {
          throw e;
        });
    
        uploadStream.on('success', () => {});

        if (this.encrypted_client_side) {
          const cipher = crypto.createCipher(this.client_encryption_algo, this.encryption_key);
          file
            .pipe(cipher)
            .pipe(uploadStream);
        } else {
          file.pipe(uploadStream);
        }
      }
    } catch (e) {
      reject(e);
    }
  });
}


/**
 * middleware function for handling multi-part form data
 * 
 * @param {object} req express request object
 * @param {object} res express response object
 * @param {function} next express next handler
 */
function pkgCloudUploadMiddleware(req, res, next) {
  if (req.headers[ 'content-type' ].toLowerCase().indexOf('multipart/form-data') === -1) {
    next();
  } else {
    const busboy = new Busboy({ headers: req.headers, });
    const middlewareInstance = Object.assign({}, {
      body: {},
      files: [],
      cloudfiles: [],
      completedFormProcessing: false,
      wait_for_cloud_uploads: (typeof req.wait_for_cloud_uploads === 'boolean') ? req.wait_for_cloud_uploads : this.wait_for_cloud_uploads,
      req,
      res,
    }, this);
    const completeHandler = periodic.core.files.completeFormHandler.bind(middlewareInstance, { req, res, next, });
    middlewareInstance.completeHandler = completeHandler;
    const fileHandler = pkgCloudFormFileHandler.bind(middlewareInstance);
    const fieldHandler = periodic.core.files.formFieldHandler.bind(middlewareInstance);
    busboy.on('file', fileHandler);
    busboy.on('field', fieldHandler);
    busboy.on('finish', () => {
      if (this.wait_for_cloud_uploads === false) {
        completeHandler();
      }
    });
    req.pipe(busboy);
  }
}


function pkgCloudUploadFileHandler(options = {}) {
  return pkgCloudUploadFile.bind(Object.assign({
    pkgcloud_client: this.pkgcloud_client,
    wait_for_cloud_uploads: true,
  }, periodic.core.files.uploadMiddlewareHandlerDefaultOptions, options));
}

/**
 * return a middleware fuction for handling file uploads with busboy
 * 
 * @param {boolean} options.save_to_disk should the files be saved to disk 
 * @param {boolean} options.save_to_req_files append file data to req object on req.files 
 * @param {boolean} options.save_file_to_asset create an asset document in the database after the files have been processes
 * @param {boolean} options.use_buffers use buffers to process files
 * @param {string} options.asset_core_data core data collection name
 * @param {object} options.periodic periodic instance to use to save data
 * @param {boolean} options.send_response file middleware should call next or send http response
 * @param {function} options.complete_form_post_hook post asset creation hook that are passed {req,res,periodic,assets}
 * @returns 
 */
function pkgCloudUploadMiddlewareHandler(options = {}) {
  //needs to be bound with this.pkgcloud_client
  return pkgCloudUploadMiddleware.bind(Object.assign({
    pkgcloud_client: options.pkgcloud_client || this.pkgcloud_client,
    wait_for_cloud_uploads: true,
  }, periodic.core.files.uploadMiddlewareHandlerDefaultOptions, options));
}

function removeCloudFilePromise(options) {
  const { asset, } = options;
  if (asset.locationtype !== 'local') {
    return new Promise((resolve, reject) => {
      const containerName = (asset.attributes)
        ? asset.attributes.cloudcontainername
        : asset.attributes.cloudcontainername;
      const containerFilepath = (asset.attributes)
        ? asset.attributes.cloudfilepath
        : asset.attributes.cloudfilepath;
      this.pkgcloud_client.client.removeFile(containerName, containerFilepath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  } else {
    return undefined;
  }
}

function pkgCloudRemoveMiddlewareHandler(options) {
  const removeFilePromise = removeCloudFilePromise.bind(this);
  return periodic.core.files.removeMiddleware.bind(Object.assign({
    removeFilePromise,
  }, periodic.core.files.removeMiddlewareHandlerDefaultOptions, options));
}

module.exports = {
  pkgCloudUploadDirectory,
  pkgCloudFormFileHandler,
  pkgCloudUploadMiddleware,
  removeCloudFilePromise,
  pkgCloudUploadMiddlewareHandler,
  pkgCloudRemoveMiddlewareHandler,
  pkgCloudUploadFileHandler,
  pkgCloudUploadFile,
};
