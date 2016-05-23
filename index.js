'use strict';

var debug     = require('debug')('heya-io:bundle');
var request   = require('request');
var par       = require('heya-async').par;
var promisify = require('heya-async/promisify');


var requestAsync = promisify(request, null, true);
requestAsync.original = request;


function identity (x) { return x; }

function defaultSetHeaders (results, res) {
	results.forEach(function (response) {
		var rawHeaders = response[0].rawHeaders;
		for(var i = 0; i < rawHeaders.length; i += 2) {
			res.set(rawHeaders[i], rawHeaders[i + 1]);
		}
	});
}


function instrumentBundle (opt) {
	var maxRequests = opt.maxRequests || 20,
		isUrlAcceptable = opt.isUrlAcceptable,
		resolveUrl = opt.resolveUrl,
		setHeaders = opt.setHeaders || defaultSetHeaders,
		processResult  = opt.processResult  || identity,
		processFailure = opt.processFailure || identity,
		processBundle  = opt.processBundle  || identity,
		onBundleStart  = opt.onBundleStart  || identity,
		onBundleFinish = opt.onBundleFinish || identity,
		onItemStart  = opt.onItemStart  || identity,
		onItemFinish = opt.onItemFinish || identity;
	return function bundle (req, res) {
		debug('=> ' + req.method + ' ' + req.url +
			  (req.body && req.body.length ? ' (payload: ' + req.body.length + ' bytes of ' + req.get('content-type') + ')' : ''));
		// no request body
		if (!req.body || !req.body.length) {
			debug('no payload');
			res.status(500).type('text/plain').send('No payload');
			return;
		}
		// wrong payload
		var payload = JSON.parse(req.body.toString());
		if (!(payload instanceof Array)) {
			debug('wrong payload');
			res.status(500).type('text/plain').send('Wrong payload');
			return;
		}
		// empty payload
		if (!payload.length) {
			debug('empty payload');
			res.json({bundle: 'bundle', results: []});
			return;
		}
		// payload is too large
		if (payload.length > maxRequests) {
			debug('large payload');
			res.status(500).type('text/plain').send('Large payload');
			return;
		}
		debug('=> RECEIVED bundle of ' + payload.length + ': ' + payload.map(function (o) { return o.url || o; }).join(', '));
		var bundleStart = Date.now(), itemStart = [];
		onBundleStart(req);
		var requests = payload.map(function (options, index) {
				itemStart[index] = Date.now();
				onItemStart(req, options, index, payload);
				var newOptions = {}, url, query, data;
				if (typeof options == 'string') {
					url = options;
				} else {
					url = options.url;
					query = options.query;
					data = options.data;
				}
				newOptions.method = options.method || 'GET';
				// make url
				if (query) {
					query = makeQuery(query) || query;
				} else {
					if (newOptions.method === 'GET' && data) {
						query = makeQuery(data);
						data = null; // data is processed as a query, no need to send it
					}
				}
				if (query) {
					url += (url.indexOf('?') < 0 ? '?' : '&') + query;
				}
				if (!isUrlAcceptable(url)) {
					return new Error('Unacceptable URL: ' + url);
				}
				newOptions.url = resolveUrl(url);
				newOptions.headers = options.headers ? Object.create(options.headers) : {};
				if (options.timeout) {
					newOptions.timeout = options.timeout;
				}
				// process data
				if (newOptions.method !== 'GET') {
					var contentType = newOptions.headers['Content-Type'];
					if (!contentType) {
						if (data) {
							newOptions.headers['Content-Type'] = 'application/json';
							newOptions.body = JSON.stringify(data);
						}
					} else if (/^application\/json\b/.test(contentType)) {
						newOptions.body = JSON.stringify(data);
					}
				}
				if (!newOptions.headers.Accept) {
					newOptions.headers.Accept = 'application/json';
				}
				newOptions.headers.Cookie = req.get('Cookie');
				debug('<= ' + newOptions.method + ' ' + url + (url !== newOptions.url ? ' => ' + newOptions.url : '') +
					(newOptions.body && newOptions.body.length ? ' (payload: ' + newOptions.body.length + ' bytes of ' + newOptions.headers['Content-Type'] + ')' : ''));
				return newOptions;
			}),
			promises = requests.map(function (options, index) {
				if(options instanceof Error) {
					onItemFinish(req, options, index, payload);
					return options;
				}
				var promise = requestAsync(options);
				promise.then(function (value) {
					onItemFinish(req, value, index, payload);
				}).catch(function (value) {
					onItemFinish(req, value, index, payload);
				});
				return promise;
			});
		par(promises).then(function (results) {
			setHeaders(results, res);
			results = results.map(function (response, index) {
				var options = normalizeOptions(payload[index]);
				if (response instanceof Error) {
					return processFailure({
						options: options,
						time: Date.now() - itemStart[index],
						response: {
							status: 500,
							statusText: response.message,
							responseType: '',
							responseText: '',
							headers: ''
						}
					}, req);
				}
				var head = response[0];
				return processResult({
					options: options,
					time: Date.now() - itemStart[index],
					response: {
						status: head.statusCode,
						statusText: head.statusMessage,
						responseType: options.responseType || '',
						responseText: response[1].toString(),
						headers: makeHeaders(head.rawHeaders, options.mime)
					}
				}, req);
			});
			debug('<= RETURNED bundle of ' + results.length);
			onBundleFinish(req);
			res.set('Content-Type', 'application/json; charset=utf-8').
				json(processBundle({
					bundle: 'bundle',
					results: results,
					time: Date.now() - bundleStart
				}, req));
		});
	};
}


function dictToPairs (dict, processPair) {
	for(var key in dict) {
		var value = dict[key];
		if (value instanceof Array) {
			for(var i = 0; i < value.length; ++i) {
				processPair(key, value[i]);
			}
		} else {
			processPair(key, value);
		}
	}
}

function makeQuery (dict) {
	var query = [];
	if (dict && typeof dict == 'object') {
		dictToPairs(dict, function (key, value) {
			query.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
		});
	}
	return query.join('&');
}

function makeHeaders (rawHeaders, mime) {
	if (mime) {
		rawHeaders = rawHeaders.filter(function (value, index, array) {
			return array[index >> 1 << 1].toLowerCase() != 'content-type';
		});
		rawHeaders.push('Content-Type', mime);
	}
	return rawHeaders.reduce(function (acc, value, index) {
		return acc + (index % 2 ? ': ' : (index ? '\r\n' : '')) + value;
	}, '');
}

function normalizeOptions (options) {
	return typeof options == 'string' ? {url: options, method: 'GET'} : options;
}


module.exports = instrumentBundle;