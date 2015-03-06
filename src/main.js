'use strict';

var fs = require('fs'),
    http = require('http'),
    https = require('https'),
    aws4 = require('aws4'),
    util = require('util'),
    Stream = require('stream');

function HttpsProxyAgent(options) {
    https.Agent.call(this, options);
 
    this.proxyHost = options.proxyHost;
    this.proxyPort = options.proxyPort;
 
    this.createConnection = function (opts, callback) {
        // do a CONNECT request
        var req = http.request({
            host: options.proxyHost,
            port: options.proxyPort,
            method: 'CONNECT',
            path: opts.host + ':' + opts.port,
            headers: {
                host: opts.host
            }
        });
 
        req.on('connect', function (res, socket, head) {
            var cts = Tls.connect({
                host: opts.host,
                socket: socket
            }, function () {
                callback(false, cts);
            });
        });
 
        req.on('error', function (err) {
            callback(err, null);
        });
 
        req.end();
    }
}
 
util.inherits(HttpsProxyAgent, https.Agent);
 
// Almost verbatim copy of http.Agent.addRequest
HttpsProxyAgent.prototype.addRequest = function (req, host, port, localAddress) {
    var name = host + ':' + port;
    if (localAddress) name += ':' + localAddress;
 
    if (!this.sockets[name]) this.sockets[name] = [];
 
    if (this.sockets[name].length < this.maxSockets) {
        // if we are under maxSockets create a new one.
        this.createSocket(name, host, port, localAddress, req, function (socket) {
            req.onSocket(socket);
        });
    } else {
        // we are over limit so we'll add it to the queue.
        if (!this.requests[name])
            this.requests[name] = [];
        this.requests[name].push(req);
    }
};
 
// Almost verbatim copy of http.Agent.createSocket
HttpsProxyAgent.prototype.createSocket = function (name, host, port, localAddress, req, callback) {
    var self = this;
    var options = util._extend({}, self.options);
    options.port = port;
    options.host = host;
    options.localAddress = localAddress;
 
    options.servername = host;
    if (req) {
        var hostHeader = req.getHeader('host');
        if (hostHeader)
            options.servername = hostHeader.replace(/:.*$/, '');
    }
 
    self.createConnection(options, function (err, s) {
        if (err) {
            err.message += ' while connecting to HTTP(S) proxy server ' + self.proxyHost + ':' + self.proxyPort;
 
            if (req)
                req.emit('error', err);
            else
                throw err;
 
            return;
        }
 
        if (!self.sockets[name]) self.sockets[name] = [];
 
        self.sockets[name].push(s);
 
        var onFree = function () {
            self.emit('free', s, host, port, localAddress);
        };
 
        var onClose = function (err) {
            // this is the only place where sockets get removed from the Agent.
            // if you want to remove a socket from the pool, just close it.
            // all socket errors end in a close event anyway.
            self.removeSocket(s, name, host, port, localAddress);
        };
 
        var onRemove = function () {
            // we need this function for cases like HTTP 'upgrade'
            // (defined by WebSockets) where we need to remove a socket from the pool
            // because it'll be locked up indefinitely
            self.removeSocket(s, name, host, port, localAddress);
            s.removeListener('close', onClose);
            s.removeListener('free', onFree);
            s.removeListener('agentRemove', onRemove);
        };
 
        s.on('free', onFree);
        s.on('close', onClose);
        s.on('agentRemove', onRemove);
 
        callback(s);
    });
};

/**
 * Default options used for request body.
 * These *can* be overriden. The properties are all lower-case on purpose,
 * they are uppercased when a request is made.
 */
var voiceSettings = {
    input: {
        data : null,
        type : 'text/plain'
    },
    outputFormat: {
        codec      : 'MP3',
        sampleRate : 22050
    },
    Parameters: {
        rate           : 'medium',
        volume         : 'medium',
        sentenceBreak  : 500,
        paragraphBreak : 650
    },
    voice: {
        name     : 'Salli',
        language : 'en-US',
        gender   : 'Female'
    }
};

var voiceListSettings = {};

function pluck(source, prop) {
    var output = {},
        i;
    var props = Array.prototype.slice.call(arguments, 1);

    for (i in source)
        if (props.indexOf(i) >= 0) output[i] = source[i];

    return output;
}

/**
 * Merge two objects, the first being the "source" with least value priority
 * (the `reference` will always overwrite).
 *
 * @param  {Object} source    The seed object
 * @param  {Object} reference The object whose prop/val will be written to `source`
 * @param  {Boolean} deep     Recursively merge objects?
 * @return {Object}           A copy of the seed merged with the reference
 */
function merge(source, reference, deep) {
    var output = {},
        i;

    for (i in source) output[i] = source[i];

    for (i in reference) {
        if (typeof reference[i] === 'object' && deep === true) {
            output[i] = merge(output[i], reference[i], deep);
        } else {
            output[i] = reference[i];
        }
    }

    return output;
}

/**
 * Capitalize all property names within an object, with the option to do so recursively.
 * @param  {Object} source The seed object
 * @param  {Boolean} deep  Recursively capitalize properties
 * @return {Object}        A copy of the seed with capitalized property names
 */
function caseProperties(source, deep, lower) {
    var output = {},
        i;
    var method = lower ? 'toLowerCase' : 'toUpperCase';

    for (i in source) {
        if (typeof source[i] !== 'object') {
            output[i.charAt(0)[method]() + i.substr(1)] = source[i];
        } else {
            output[i.charAt(0)[method]() + i.substr(1)] = caseProperties(source[i], deep, lower);
        }
    }

    return output;
}

/**
 * An Ivona Cloud API request
 * @param {Object} request - a signed request returned from `aws4`
 */
function IvonaRequest(request, keys) {
    if (request.buffer) this.buffer = true;

    this.signedCredentials = aws4.sign(request, {
        accessKeyId: keys.accessKey,
        secretAccessKey: keys.secretKey
    });

    this.proxy = request.proxy;
}

IvonaRequest.prototype = {
    //  the last given credentials
    signedCredentials: null,
    //  the last active request
    stream: null,

    /**
     * execute the request
     * @return {ReadableStream} the streamed audio response from Ivona
     */
    exec: function() {
        var req;
        var buffer = this.buffer;
        var data = '';

        var requestParams = this.signedCredentials;

        if (this.proxy !== undefined) {
            var agent = new HttpsProxyAgent({
                proxyHost: this.proxy.host,
                proxyPort: this.proxy.port
            });

            requestParams.agent = agent;
        }

        req = https.request(requestParams, function(res) {

            res.on('data', function(chunk) {
                if (buffer) data += chunk;
                req.emit('data', chunk);
            });

            res.on('end', function() {
                if (buffer) {
                    if (/json/i.test(res.headers['content-type'])) {
                        req.emit('complete', caseProperties(JSON.parse(data), true, true));
                    } else {
                        req.emit('complete', data);
                    }
                }
                data = null;
                req.emit('end');
            });

            res.on('error', function(err) {
                throw new Error(err);
            });

        });

        if (this.signedCredentials.body) req.write(this.signedCredentials.body);
        req.end();

        return (this.stream = req);
    }
};

/**
 * The Ivona API interface.
 * @param {Object} config - configuration for Ivona Cloud account
 */
function Ivona(config) {
    //  THESE ARE NOT REQUIRED (and for the foreseeable future shouldn't be overridden)
    this.host = config.host || 'tts.eu-west-1.ivonacloud.com';
    this.service = config.service || 'tts';
    this.method = config.method || 'POST';
    this.region = config.region || 'eu-west-1';

    this.proxy = config.proxy || undefined;

    //  THESE ARE REQUIRED
    this.accessKey = config.accessKey;
    this.secretKey = config.secretKey;
}

Ivona.prototype = {
    request: null,
    voices: null,

    /**
     * Creates a default request config (used by `Ivona`)
     * @param  {String} path   The path to the service being used
     * @param  {Object} config (optional) configuration for request
     * @return {Object}        The default request options
     */
    getRequest: function(path, config) {
        return {
            path    : path,
            host    : config.host || this.host,
            buffer  : config.buffer || false,
            service : config.service || this.service,
            method  : config.method || this.method,
            region  : config.region || this.region,
            proxy   : config.proxy || this.proxy,
            headers: {
                'content-type': 'application/json'
            },
            body: config.body || ''
        };
    },

    /**
     * Interface to the Ivona Cloud `createVoice` endpoint
     * @param  {String} text    The text to be spoken
     * @param  {Object} config  Configuration overrides
     * @return {IvonaRequest}   The `https.request` returned from an `IvonaRequest`
     */
    createVoice: function(text, config) {
        if (!config) config = {};

        if (config.body) {
            config.body = merge(Object.create(voiceSettings), config.body);
        } else {
            config.body = Object.create(voiceSettings);
        }

        config.body.input.data = text;
        //  must be string for aws4
        config.body = JSON.stringify(caseProperties(config.body, true));

        this.request = new IvonaRequest(
            this.getRequest('/CreateSpeech', config),
            this
        );

        return this.request.exec();
    },

    /**
     * Interface to the Ivona Cloud `ListVoices` endpoint
     * @param  {Object} config  Configuration overrides
     * @return {IvonaRequest}   The `https.request` returned from an `IvonaRequest`
     */
    listVoices: function(config) {
        if (!config) config = {};

        if (config.body) {
            config.body = merge(Object.create(voiceListSettings), config.body);
        } else {
            config.body = Object.create(voiceListSettings);
        }
        //  must be string for aws4
        config.body = JSON.stringify(caseProperties(config, true));
        config.buffer = true;

        this.request = new IvonaRequest(
            this.getRequest('/ListVoices', config || {}),
            this
        );

        return this.request.exec();
    }
};

module.exports = Ivona;