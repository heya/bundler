'use strict';

const http = require('http');
const path = require('path');
const debug = require('debug')('heya-io:server');
const express = require('express');
const bodyParser = require('body-parser');

const bundler = require('../main');

// The APP

const rep = (s, n) => {
  if (n <= 0) return '';
  let result = '';
  for (let mask = 1, buffer = s; n; mask <<= 1, buffer += buffer) {
    if (!(n & mask)) continue;
    result += buffer;
    n -= mask;
  }
  return result;
};

const app = express();

app.use(bodyParser.raw({type: '*/*'}));

let counter = 0;

app.all('/api*', (req, res) => {
  if (req.query.status) {
    let status = parseInt(req.query.status, 10);
    if (isNaN(status) || status < 100 || status >= 600) {
      status = 200;
    }
    res.status(status);
  }
  switch (req.query.payloadType) {
    case 'txt':
      res.set('Content-Type', 'text/plain');
      res.send('Hello, world!');
      return;
    case 'xml':
      res.set('Content-Type', 'application/xml');
      res.send('<div>Hello, world!</div>');
      return;
  }
  if (req.query.pattern && /^\d+$/.test(req.query.repeat)) {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    const data = rep(req.query.pattern, +req.query.repeat);
    res.send(data);
    return;
  }
  const data = {
    method: req.method,
    protocol: req.protocol,
    hostname: req.hostname,
    url: req.url,
    originalUrl: req.originalUrl,
    headers: req.headers,
    body: (req.body && req.body.length && req.body.toString()) || null,
    query: req.query,
    now: Date.now(),
    counter: counter++
  };
  let timeout = 0;
  if (req.query.timeout) {
    timeout = parseInt(req.query.timeout, 10);
    if (isNaN(timeout) || timeout < 0 || timeout > 60000) {
      timeout = 0;
    }
  }
  if (timeout) {
    setTimeout(() => res.jsonp(data), timeout);
  } else {
    res.jsonp(data);
  }
});

const isUrlAcceptable = uri => typeof uri == 'string' && !/^\/\//.test(uri) && (uri.charAt(0) === '/' || /^http:\/\/localhost:3000\//.test(uri));

const resolveUrl = uri => (uri.charAt(0) === '/' ? 'http://localhost:3000' + uri : uri);

app.put(
  '/bundle',
  bundler({
    isUrlAcceptable: isUrlAcceptable,
    resolveUrl: resolveUrl
  })
);

app.use(express.static(path.join(__dirname, '..')));

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

app.use(function (err, req, res, next) {
  // for simplicity we don't use fancy HTML formatting opting for a plain text
  res.status(err.status || 500);
  res.set('Content-Type', 'text/plain');
  res.send('Error (' + err.status + '): ' + err.message + '\n' + err.stack);
  debug('Error: ' + err.message + ' (' + err.status + ')');
});

// The SERVER

/**
 * Normalize a port into a number, string, or false.
 */

const normalizePort = val => {
  const port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
};

/**
 * Get port from environment and store in Express.
 */

const host = process.env.HOST || 'localhost',
  port = normalizePort(process.env.PORT || '3000');
app.set('port', port);

/**
 * Create HTTP server.
 */

const server = http.createServer(app);

/**
 * Human-readable port description.
 */

const portToString = port => (typeof port === 'string' ? 'pipe ' + port : 'port ' + port);

/**
 * Event listener for HTTP server "error" event.
 */

const onError = error => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = portToString(port);

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error('Error: ' + bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error('Error: ' + bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
};

/**
 * Event listener for HTTP server "listening" event.
 */

const onListening = () => {
  // const addr = server.address();
  const bind = portToString(port);
  debug('Listening on ' + (host || 'all network interfaces') + ' ' + bind);
};

/**
 * Listen on provided port, on provided host, or all network interfaces.
 */

server.listen(port, host);
server.on('error', onError);
server.on('listening', onListening);
