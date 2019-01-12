# Bundler

[![Build status][travis-image]][travis-url]
[![Dependencies][deps-image]][deps-url]
[![devDependencies][dev-deps-image]][dev-deps-url]
[![NPM version][npm-image]][npm-url]

Intelligent I/O for browsers: a bundler endpoint for node.js.

## What is it?

A flexible customizable endpoint for [Express](http://expressjs.com/) on node.js that implements [heya-io](https://github.com/heya/io)'s bundling [protocol](https://github.com/heya/bundler/wiki/Protocol). It is a reference implementation for its `bundle()` facility.

Example of use:

```js
var bundler = require('heya-bundler');
var express = require('express');

var app = express();
var router = express.Router();

router.put('/', instrumentBundle({
  isUrlAcceptable: function (url) {
    // accept only local absolute URLs
    return /^\/\w/.test(url);
  }
}));

app.use('/bundle', router);

// the rest of the setup
```

All supported parameters can be found in [Instrumentation](https://github.com/heya/bundler/wiki/Instrumentation).

## How to install

```sh
npm install --save heya-bundler
```

## Documentation

All documentation can be found in [project's wiki](https://github.com/heya/bundler/wiki).

## License

BSD or AFL &mdash; your choice

## Versions

- 1.1.0 &mdash; *Switched from `request` to `heya-io-node`!*
- 1.0.7 &mdash; *Refreshed dependencies.*
- 1.0.6 &mdash; *Corrected links. No code change.*
- 1.0.5 &mdash; *Switched from 500 to 400 to indicate bad requests, checked JSON and request for exceptions.*
- 1.0.4 &mdash; *Added a way to customize logging.*
- 1.0.3 &mdash; *More accurate calculations of spent time and better error reports.*
- 1.0.2 &mdash; *Minor documentation update.*
- 1.0.1 &mdash; *Sorted out dependencies.*
- 1.0.0 &mdash; *Starts the new generation.*


[npm-image]:      https://img.shields.io/npm/v/heya-bundler.svg
[npm-url]:        https://npmjs.org/package/heya-bundler
[deps-image]:     https://img.shields.io/david/heya/bundler.svg
[deps-url]:       https://david-dm.org/heya/bundler
[dev-deps-image]: https://img.shields.io/david/dev/heya/bundler.svg
[dev-deps-url]:   https://david-dm.org/heya/bundler?type=dev
[travis-image]:   https://img.shields.io/travis/heya/bundler.svg
[travis-url]:     https://travis-ci.org/heya/bundler
