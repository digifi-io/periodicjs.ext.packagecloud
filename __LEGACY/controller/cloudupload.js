'use strict';

const crypto = require('crypto');

var path = require('path'),
    async = require('async'),
    fs = require('fs-extra'),
    multer = require('multer'),
    moment = require('moment'),
    pkgcloud = require('@yawetse/pkgcloud'),
    extend = require('util-extend'),
    https = require('https'),
    cloudprovider,
    cloudproviderfilepath,
    cloudstorageclient,
    cloudStorageClientError,
    cloudStorageContainer,
    cloudStoragePublicPath,
    CoreExtension,
    CoreUtilities,
    CoreController,
    use_client_file_encryption,
    get_client_encryption_key_string,
    encrypt_file_chain,
    localAssetDecrypt,
    // multiupload_rename,
    // multiupload_changeDest,
    // multiupload_onParseStart,
    upload_dir,
    temp_upload_dir,
    appSettings,
    mongoose,
    MediaAsset,
    logger,
    client_encryption_algo,
    multiupload;

// var multiupload_rename = function(fieldname,filename,req,res){
// 	if(req.user){
// 		return req.user._id+'-'+filename+'_'+moment().format('YYYY-MM-DD_HH-m-ss');
// 	}
// 	else{
// 		return fieldname+'-'+filename+'_'+moment().format('YYYY-MM-DD_HH-m-ss');
// 	}
// };

// var multiupload_changeDest = function(dest, req, res) {
// 	var current_date = moment().format('YYYY/MM/DD'),
// 		upload_path_dir = path.join(process.cwd(), upload_dir,'cloudfiles',current_date);
//   		// return upload_path_dir; 

// 	// logger.debug('upload_path_dir',upload_path_dir);
// 	fs.ensureDirSync(upload_path_dir);
// 	return upload_path_dir; 
// };

// var multiupload_onParseStart = function () {
//   logger.debug('Form parsing started at: ', new Date());
// };

var deletelocalfile = function(filepath) {
    fs.remove(filepath, function(err) {
        if (err) {
            logger.error(err);
        } else {
            logger.silly('removing temp file', filepath);
        }
    });
};

var uploadFileIterator = function(uploadedfile, callback) {
    var current_date = moment().format('YYYY/MM/DD'),
        clouddir;
    clouddir = (typeof uploadedfile.clouddir === 'string') ? uploadedfile.clouddir : path.join('cloudfiles', current_date);
    uploadedfile = (typeof uploadedfile.path === 'string') ? uploadedfile : uploadedfile.uploadedfileObject;
    var newfilepath = path.join(clouddir, uploadedfile.name);
    // console.log('uploadFileIterator running', uploadedfile);
    if (uploadedfile.attributes && uploadedfile.attributes.encrypted_client_side) {
        // console.log('uploadedfile.attributes.encrypted_client_side', uploadedfile.attributes.encrypted_client_side);
        newfilepath += '.enc';
    }
    var localuploadfile = fs.createReadStream(uploadedfile.path),
        originalFilePath = uploadedfile.path,
        cloudupload = cloudstorageclient.upload({
            container: cloudStorageContainer,
            remote: newfilepath,
            local: uploadedfile.path,
            'Cache-Control': 'public, max-age=86400',
            cacheControl: 'public, max-age=86400',
            'Content-Type': uploadedfile.mimetype,
            contentType: uploadedfile.mimetype,
            ServerSideEncryption: 'AES256',
            ACL: 'public-read',
            acl: 'public-read',
            headers: {
                // optionally provide raw headers to send to cloud files
                'cache-control': 'public, max-age=86400',
                'Cache-Control': 'public, max-age=86400',
                'Content-Type': uploadedfile.mimetype,
                'x-amz-meta-Cache-Control': 'public, max-age=86400'
            }
        });
    cloudupload.on('success', function(uploaded_cloud_file) {
        uploaded_cloud_file.attributes = cloudStoragePublicPath;
        uploaded_cloud_file.size = uploadedfile.size;
        uploaded_cloud_file.filename = uploadedfile.name;
        uploaded_cloud_file.name = uploadedfile.name;
        uploaded_cloud_file.assettype = uploadedfile.mimetype;
        uploaded_cloud_file.mimetype = uploadedfile.mimetype;
        uploaded_cloud_file.path = newfilepath;
        uploaded_cloud_file.locationtype = cloudprovider.provider;
        // uploaded_cloud_file.attributes.periodicDirectory = uploadDirectory;
        // uploaded_cloud_file.attributes.periodicPath = path.join(cloudStoragePublicPath.cdnUri,newfilepath);
        var filelocation = (cloudprovider.provider === 'amazon') ? uploaded_cloud_file.location : cloudStoragePublicPath.cdnUri + '/' + newfilepath;
        uploaded_cloud_file.fileurl = filelocation;
        if (uploadedfile.attributes && uploadedfile.attributes.encrypted_client_side && uploadedfile.encrypted_client_side !== false) {
            uploaded_cloud_file.attributes.client_encryption_algo = uploadedfile.attributes.client_encryption_algo;
        }
        uploaded_cloud_file.attributes.encrypted_client_side = uploadedfile.attributes.encrypted_client_side;
        uploaded_cloud_file.attributes.periodicFilename = uploadedfile.name;
        uploaded_cloud_file.attributes.cloudfilepath = newfilepath;
        uploaded_cloud_file.attributes.cloudcontainername = cloudStorageContainer.name || cloudStorageContainer;
        uploaded_cloud_file = Object.assign({}, uploadedfile, uploaded_cloud_file);
        // cloudfiles.push(uploaded_cloud_file);
        // console.log('trying to delete',originalFilePath);
        if (!uploadedfile.keep_local_files) {
            deletelocalfile(originalFilePath);
        }
        callback(null, uploaded_cloud_file);
    });
    // cloudupload.on('end',function(){
    // 	deletelocalfile(uploadedfile.path);
    // });
    cloudupload.on('error', function(err) {
        logger.error('asyncadmin - async each cloudupload error', err);
        callback(err);
        if (!uploadedfile.keep_local_files) {
            deletelocalfile(uploadedfile.path);
        }
    });
    localuploadfile.pipe(cloudupload);
};

var multiupload_onParseEnd = function(req, next) {
    // logger.debug('req.body',req.body);
    // logger.debug('req.files',req.files);
    req.controllerData = req.controllerData || {};
    var files = [],
        current_date = moment().format('YYYY/MM/DD'),
        clouddir = path.join('cloudfiles', current_date),
        use_file_encryption = use_client_file_encryption({ req: req }),
        cloudfiles = [],
        file_obj,
        get_file_obj = function(data) {
            var returndata = data;
            // console.log('get_file_obj original data', data);
            returndata.uploaddirectory = returndata.path.replace(process.cwd(), '').replace(returndata.name, '');
            if (use_file_encryption) {
                returndata.attributes = returndata.attributes || {};
                returndata.attributes.encrypted_client_side = true;
                returndata.attributes.client_encryption_algo = client_encryption_algo;
                returndata.encrypted_client_side = true;
            }
            // console.log('get_file_obj returndata', returndata);
            return returndata;
        };

    var process_cloud_files = function() {
        try {
            if (files) {
                // console.log('files', files);
                async.eachSeries(files,
                    function(uploadedfile, eachcb) {
                        if (req.body.keep_local_files || req.controllerData.keep_local_files) {
                            uploadedfile = uploadedfile || {};
                            uploadedfile.keep_local_files = true;
                        }
                        if (typeof use_file_encryption === 'undefined') {
                            uploadedfile.attributes = Object.assign({}, uploadedfile.attributes, { encrypted_client_side: false });
                            uploadedfile.encrypted_client_side = false;
                            uploadedfile.attributes.encrypted_client_side = false;
                        }
                        if (uploadedfile.encrypted_client_side === false) {
                            uploadedfile.attributes.encrypted_client_side = false;

                        }
                        uploadFileIterator(uploadedfile, function(err, uploaded_cloud_file) {
                            // console.log('err,uploaded_cloud_file',err,uploaded_cloud_file);
                            if (err) {
                                eachcb(err);
                            } else {
                                cloudfiles.push(uploaded_cloud_file);
                                eachcb();
                            }
                        });
                    },
                    function(err) {
                        if (err) {
                            next(err);
                        } else {
                            req.controllerData = (req.controllerData) ? req.controllerData : {};
                            req.controllerData.files = cloudfiles;
                            // console.log('req.controllerData.files', req.controllerData.files);
                            next();
                        }
                    });
            } else {
                next();
            }
        } catch (e) {
            logger.error('asyncadmin - cloudupload.multiupload', e);
            next(e);
        }
    };
    for (var x in req.files) {
        if (Array.isArray(req.files[x])) {
            for (var y in req.files[x]) {
                file_obj = get_file_obj(req.files[x][y]);
                // file_obj.uploaddirectory = file_obj.path.replace(process.cwd(),'');
                // file_obj.uploaddirectory = file_obj.uploaddirectory.replace(file_obj.name,'');
                files.push(file_obj);
            }
        } else {
            file_obj = get_file_obj(req.files[x]);
            // file_obj.uploaddirectory = file_obj.path.replace(process.cwd(),'');
            // file_obj.uploaddirectory = file_obj.uploaddirectory.replace(file_obj.name,'');
            files.push(file_obj);
        }
    }
    if (use_file_encryption) {
        async.map(
            files,
            encrypt_file_chain,
            function(err, encrypted_files) {
                // console.log('encrypted_files',encrypted_files);
                files = encrypted_files;
                process_cloud_files();
            });
    } else {
        process_cloud_files();
    }
    // req.controllerData = (req.controllerData) ? req.controllerData : {};
    // req.controllerData.files = files;
    // next();
};



/**
 * deletes file from cloud and removes document from mongo database
 * @param  {object} req 
 * @param  {object} res 
 */
var remove = function(req, res) {
    var asset = req.controllerData.asset;
    async.parallel({
        deletefile: function(callback) {
            // console.log('asset', asset);
            try {
                if (asset.locationtype === 'rackspace' || asset.locationtype === 'amazon') {
                    cloudstorageclient.removeFile(asset.attributes.cloudcontainername, asset.attributes.cloudfilepath, callback);
                } else {
                    fs.remove(path.join(process.cwd(), asset.attributes.periodicPath), callback);
                }
            } catch (e) {
                callback(e);
            }
        },
        removeasset: function(callback) {
            CoreController.deleteModel({
                model: MediaAsset,
                deleteid: asset._id,
                req: req,
                res: res,
                callback: callback
            });
        }
    }, function(err
        //, results
    ) {
        if (err) {
            logger.error('err', err);
            CoreController.handleDocumentQueryErrorResponse({
                err: err,
                res: res,
                req: req
            });
        } else {
            CoreController.handleDocumentQueryRender({
                req: req,
                res: res,
                redirecturl: '/p-admin/assets',
                responseData: {
                    result: 'success',
                    data: asset
                }
            });
        }
    });
};

/**
 * create storage container from configuration in provider.json
 * @param  {object} req 
 * @param  {object} res 
 * @return {Function} next() callback
 */
var createStorageContainer = function() {
    fs.readJson(cloudproviderfilepath, function(err, data) {
        if (err) {
            cloudStorageClientError = err;
            logger.error('createStorageContainer readJson cloudproviderfilepath', cloudproviderfilepath);
            logger.error(err);
        } else {
            try {
                cloudprovider = data[appSettings.application.environment];
                cloudstorageclient = pkgcloud.storage.createClient(cloudprovider);
                var storageContainerOptions = {
                    name: (cloudprovider.containername) ? cloudprovider.containername : 'periodicjs',
                    type: 'public',
                    metadata: {
                        env: appSettings.application.environment,
                        name: appSettings.name
                    }
                };
                if (cloudprovider.provider === 'amazon') {

                    cloudStorageContainer = cloudprovider.containername || cloudprovider.Bucket || cloudprovider.bucket;
                    cloudStoragePublicPath = {
                        cdnUri: 'http://' + cloudstorageclient.s3.config.endpoint + '/' + cloudStorageContainer,
                        cdnSslUri: cloudstorageclient.s3.endpoint.href + cloudStorageContainer,
                        endpoint: cloudstorageclient.s3.endpoint
                    };
                } else if (cloudprovider.provider === 'rackspace') {
                    cloudstorageclient.createContainer(
                        storageContainerOptions,
                        function(err, container) {
                            if (err) {
                                console.log('failed on storage client', err);
                                console.log(err.stack);
                                cloudStorageClientError = err;
                                throw Error(err);
                            } else {
                                console.log('created container');
                                cloudStorageContainer = container;
                                if (cloudprovider.provider === 'rackspace') {
                                    cloudstorageclient.setCdnEnabled(cloudStorageContainer, true, function(error, cont) {
                                        if (error) {
                                            cloudStorageClientError = error;
                                            throw Error(error);
                                        } else if (cont) {
                                            cloudStoragePublicPath = {
                                                cdnUri: cont.cdnUri,
                                                cdnSslUri: cont.cdnSslUri,
                                                cdnStreamingUri: cont.cdnStreamingUri,
                                                cdniOSUri: cont.cdniOSUri
                                            };
                                            // console.log('cont', cont);
                                            // console.log('cloudStoragePublicPath', cloudStoragePublicPath);
                                            logger.silly('Successfully Created CDN Bucket');
                                        }
                                    });
                                }
                            }
                        });
                }
                // console.log('cloudstorageclient',cloudstorageclient);
                // console.log('cloudprovider',cloudprovider);
                // console.log('storageContainerOptions',storageContainerOptions);
                cloudprovider.containername = cloudprovider.containername || cloudprovider.Bucket || cloudprovider.bucket || 'periodicjs';
            } catch (e) {
                logger.error('cloudstorageclient.createContainer cloudStorageClientError');
                cloudStorageClientError = e;
                console.log(e);
                logger.error(e);
            }
        }
    });
};

var decryptHTTPStream = function(options, cb) {
    try {
        https.get(options.url, function(https_download_response) {
            var encryption_key_password = get_client_encryption_key_string();
            var decipher = crypto.createDecipher(options.algorithm || 'aes192', encryption_key_password);
            https_download_response.pipe(decipher).pipe(options.writeStream || options.res);
            https_download_response.on('end', () => {
                cb(null, {
                    result: 'success',
                    data: {
                        message: 'download complete'
                    }
                });
            });
            https_download_response.on('error', e => {
                cb(e);
            });
        });
    } catch (e) {
        cb(e);
    }
};

var decryptAsset = function(req, res) {
    req.controllerData = req.controllerData || {};
    var asset = req.controllerData.asset;
    if (asset.assettype === 'local') {
        // console.log('local decrypt');
        localAssetDecrypt(req, res);
    } else {
        // console.log('remote decrypt');
        var encrypted_file_path = asset.fileurl;
        res.setHeader('Content-Type', asset.assettype);
        if (asset.size) {
            res.setHeader('Content-Length', asset.size);
        }
        if (!req.query.nocache || !req.body.nocache || !req.controllerData.nocache) {
            res.setHeader('Content-Control', 'public, max-age=86400');
        }
        decryptHTTPStream({
            res: res,
            url: encrypted_file_path
        }, function(err) {
            if (err) {
                logger.error('error decrypting file.', err);
                res.status(500);
                CoreController.handleDocumentQueryErrorResponse({
                    err: err,
                    res: res,
                    req: req
                });
            } else {
                logger.silly('decrypted file');
            }
        });
    }
};

/**
 * cloudupload controller
 * @module clouduploadController
 * @{@link https://github.com/typesettin/periodicjs.ext.clouduploads}
 * @author Yaw Joseph Etse
 * @copyright Copyright (c) 2014 Typesettin. All rights reserved.
 * @license MIT
 * @requires module:async
 * @requires module:path
 * @requires module:fs-extra
 * @requires module:formidable
 * @requires module:pkgcloud
 * @requires module:periodicjs.core.utilities
 * @requires module:periodicjs.core.controller
 * @requires module:periodicjs.core.extensions
 * @param  {object} resources variable injection from current periodic instance with references to the active logger and mongo session
 */
var controller = function(resources) {
    logger = resources.logger;
    mongoose = resources.mongoose;
    appSettings = resources.settings;
    CoreController = resources.core.controller;
    CoreUtilities = resources.core.utilities;
    CoreExtension = resources.core.extension;
    MediaAsset = mongoose.model('Asset');
    // multiupload_rename = resources.app.controller.native.asset.multiupload_rename;	
    // multiupload_changeDest = resources.app.controller.native.asset.multiupload_changeDest;
    // multiupload_onParseStart = resources.app.controller.native.asset.multiupload_onParseStart;
    upload_dir = resources.app.controller.native.asset.upload_dir;
    temp_upload_dir = path.join(process.cwd(), upload_dir, '/tmp');
    use_client_file_encryption = resources.app.controller.native.asset.use_client_file_encryption;
    get_client_encryption_key_string = resources.app.controller.native.asset.get_client_encryption_key_string;
    localAssetDecrypt = resources.app.controller.native.asset.decryptAsset;
    encrypt_file_chain = resources.app.controller.native.asset.encrypt_file_chain;
    client_encryption_algo = resources.app.controller.native.asset.client_encryption_algo;
    // console.log('temp_upload_dir',temp_upload_dir);
    // console.log('resources.app.controller.native.asset',resources.app.controller.native.asset);

    cloudproviderfilepath = path.join(CoreExtension.getconfigdir({
        extname: 'periodicjs.ext.clouduploads'
    }), 'provider.json');
    // Collection = mongoose.model('Collection');
    // 
    // cdn files: https://github.com/pkgcloud/pkgcloud/issues/324
    // rackspace: https://gist.github.com/rdodev/129592b4addcebdf6ccd
    createStorageContainer();

    // console.log('resources.app.controller.native.asset',resources.app.controller.native.asset)

    multiupload = multer({
        includeEmptyFields: false,
        putSingleFilesInArray: true,
        dest: temp_upload_dir,
        rename: resources.app.controller.native.asset.rename,
        changeDest: resources.app.controller.native.asset.changeDest,
        onParseStart: resources.app.controller.native.asset.onParseStart,
        onParseEnd: multiupload_onParseEnd
    });

    return {
        multiupload: multiupload,
        multiupload_onParseEnd: multiupload_onParseEnd,
        uploadFileIterator: uploadFileIterator,
        remove: remove,
        decryptAsset: decryptAsset,
        decryptHTTPStream: decryptHTTPStream,
        cloudstorageclient: function() {
            return cloudstorageclient;
        }
    };
};

module.exports = controller;