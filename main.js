'use strict';

const debug = require('debug')('heya-io:bundle');
const io = require('heya-io-node');
const {par} = require('heya-async');

const identity = x => x;

const defaultSetHeaders = (results, res) =>
  results.forEach(response => {
    if (!(response instanceof Error)) {
      const headers = io.getHeaders(response);
      Object.keys(headers).forEach(key => res.set(key, headers[key]));
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
  const headers = io.getHeaders(xhr);
  mime && (headers['content-type'] = mime);
  return Object.keys(headers)
    .map(key => key + ': ' + headers[key])
    .join('\r\n');
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
      res
        .status(400)
        .type('text/plain')
        .send('No payload');
      return;
    }
    // wrong payload
    const payload = parseBody(req.body.toString());
    if (!(payload instanceof Array)) {
      log('error', 'wrong payload');
      res
        .status(400)
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
      res
        .status(400)
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
        const newOptions = Object.assign(
          {returnXHR: true, ignoreBadStatus: true, headers: {}, method: 'GET'},
          typeof options == 'string' ? {url: options} : options
        );
        const url = newOptions.url;
        newOptions.headers = Object.assign({}, newOptions.headers);
        if (!isUrlAcceptable(url)) {
          return new Error('Unacceptable URL: ' + url);
        }
        newOptions.url = resolveUrl(url);
        // process cookie
        const cookie = req.get('Cookie');
        if (cookie) {
          const foundCookie = Object.keys(newOptions.headers).some(key => {
            if (key.toLowerCase() == 'cookie') {
              newOptions.headers[key] = cookie;
              return true;
            }
            return false;
          });
          if (!foundCookie) {
            newOptions.headers.Cookie = cookie;
          }
        }
        if (!Object.keys(newOptions.headers).length) {
          delete newOptions.headers;
        }
        log('info', '<= ' + newOptions.method + ' ' + url + (url !== newOptions.url ? ' => ' + newOptions.url : ''), {
          method: newOptions.method,
          url: newOptions.url
        });
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
              status: response.status,
              statusText: response.statusText,
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
