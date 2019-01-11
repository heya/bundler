'use strict';

const debug = require('debug')('heya-io:bundle');
const io = require('heya-io-node');
const {par} = require('heya-async');

const identity = x => x;

const defaultSetHeaders = (results, res) =>
	results.forEach(response => {
		if (!(response instanceof Error)) {
			response
				.getAllResponseHeaders()
				.split('\r\n')
				.forEach(header => {
					const parts = header.split(': ');
					res.set(parts[0], parts[1] || '');
				});
		}
	});

const localLog = (_, msg) => debug(msg);

const dictToPairs = (dict, processPair) => {
	for (let key in dict) {
		const value = dict[key];
		if (value instanceof Array) {
			value.forEach(val => processPair(key, val));
		} else {
			processPair(key, value);
		}
	}
};

const makeQuery = dict => {
	const query = [];
	if (dict && typeof dict == 'object') {
		dictToPairs(dict, (key, value) => query.push(encodeURIComponent(key) + '=' + encodeURIComponent(value)));
	}
	return query.join('&');
};

const makeHeaders = (xhr, mime) => {
	let headers = xhr.getAllResponseHeaders();
	if (!mime) return headers;
	headers = headers
		.split('\r\n')
		.filter(header => header.split(': ')[0].toLowerCase() != 'content-type')
		.join('\r\n');
	return headers + '\r\nContent-Type: ' + mime;
};

const normalizeOptions = options => (typeof options == 'string' ? {url: options, method: 'GET'} : options);

const parseBody = body => {
	try {
		return JSON.parse(body);
	} catch (e) {
		return null;
	}
};

const instrumentBundle = opt => {
	const isUrlAcceptable = opt.isUrlAcceptable,
		maxRequests = opt.maxRequests || 20,
		resolveUrl = opt.resolveUrl || identity,
		setHeaders = opt.setHeaders || defaultSetHeaders,
		processResult = opt.processResult || identity,
		processFailure = opt.processFailure || identity,
		processBundle = opt.processBundle || identity,
		onBundleStart = opt.onBundleStart || identity,
		onBundleFinish = opt.onBundleFinish || identity,
		onItemStart = opt.onItemStart || identity,
		onItemFinish = opt.onItemFinish || identity,
		log = opt.log || localLog;
	return (req, res) => {
		log(
			'info',
			'=> ' +
				req.method +
				' ' +
				req.url +
				(req.body && req.body.length
					? ' (payload: ' + req.body.length + ' bytes of ' + req.get('content-type') + ')'
					: ''),
			{
				method: req.method,
				url: req.url,
				length: (req.body && req.body.length) || 0,
				contentType: req.get('content-type')
			}
		);
		// no request body
		if (!req.body || !req.body.length) {
			log('error', 'no payload');
			res.status(400)
				.type('text/plain')
				.send('No payload');
			return;
		}
		// wrong payload
		const payload = parseBody(req.body.toString());
		if (!(payload instanceof Array)) {
			log('error', 'wrong payload');
			res.status(400)
				.type('text/plain')
				.send('Wrong payload');
			return;
		}
		// empty payload
		if (!payload.length) {
			log('warn', 'empty payload');
			res.json({bundle: 'bundle', results: []});
			return;
		}
		// payload is too large
		if (payload.length > maxRequests) {
			log('error', 'large payload');
			res.status(400)
				.type('text/plain')
				.send('Large payload');
			return;
		}
		log(
			'info',
			'=> RECEIVED bundle of ' +
				payload.length +
				': ' +
				payload
					.map(function(o) {
						return o.url || o;
					})
					.join(', '),
			payload.map(function(o) {
				return o.url || o;
			})
		);
		const bundleStart = Date.now(),
			itemTime = [];
		onBundleStart(req);
		const requests = payload.map((options, index) => {
				itemTime[index] = Date.now();
				onItemStart(req, options, index, payload);
				const newOptions = {returnXHR: true};
				let url, query, data;
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
					const contentType = newOptions.headers['Content-Type'];
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
				log(
					'info',
					'<= ' +
						newOptions.method +
						' ' +
						url +
						(url !== newOptions.url ? ' => ' + newOptions.url : '') +
						(newOptions.body && newOptions.body.length
							? ' (payload: ' +
							  newOptions.body.length +
							  ' bytes of ' +
							  newOptions.headers['Content-Type'] +
							  ')'
							: ''),
					{
						method: newOptions.method,
						url: newOptions.url,
						length: (newOptions.body && newOptions.body.length) || 0,
						contentType: newOptions.headers['Content-Type']
					}
				);
				return newOptions;
			}),
			promises = requests.map((options, index) => {
				if (options instanceof Error) {
					onItemFinish(req, options, index, payload);
					itemTime[index] = Date.now() - itemTime[index];
					return options;
				}
				return io(options)
					.then(value => {
						onItemFinish(req, value, index, payload);
						itemTime[index] = Date.now() - itemTime[index];
						return value;
					})
					.catch(value => {
						onItemFinish(req, value, index, payload);
						itemTime[index] = Date.now() - itemTime[index];
						return value;
					});
			});
		par(promises).then(results => {
			setHeaders(results, res);
			results = results.map((response, index) => {
				const options = normalizeOptions(payload[index]);
				if (response instanceof Error) {
					return processFailure(
						{
							options: options,
							time: itemTime[index],
							response: {
								status: 500,
								statusText: response.message,
								responseType: '',
								responseText:
									'heya/bundler encountered an error: ' +
									(response.name ? '[' + response.name + '] ' : '') +
									(response.message || '(unspecified)'),
								headers: 'Content-Type: text/plain; charset=utf-8'
							}
						},
						req
					);
				}
				return processResult(
					{
						options: options,
						time: itemTime[index],
						response: {
							status: response.statusCode,
							statusText: response.statusMessage,
							responseType: options.responseType || '',
							responseText: response.responseText,
							headers: makeHeaders(response, options.mime)
						}
					},
					req
				);
			});
			onBundleFinish(req);
			const bundleTime = Date.now() - bundleStart;
			log('info', '<= RETURNED bundle of ' + results.length + ' in ' + bundleTime + 'ms', {
				length: results.length,
				time: bundleTime
			});
			res.set('Content-Type', 'application/json; charset=utf-8').json(
				processBundle(
					{
						bundle: 'bundle',
						results: results,
						time: bundleTime
					},
					req
				)
			);
		});
	};
};

module.exports = instrumentBundle;
