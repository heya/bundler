define(['module', 'heya-unit'], function(module, unit) {
  'use strict';

  function io(data, callback, errback) {
    var xhr = new XMLHttpRequest();
    if (callback) {
      xhr.addEventListener('load', function() {
        callback(xhr);
      });
    }
    if (errback) {
      xhr.addEventListener('error', function() {
        errback(xhr);
      });
    }
    xhr.open('PUT', '/bundle');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send(JSON.stringify(data));
  }

  unit.add(module, [
    function test_bundle_of_1(t) {
      var x = t.startAsync('test_bundle_of_1');
      io(
        ['http://localhost:3000/api'],
        function(xhr) {
          eval(t.TEST('xhr.status === 200'));
          eval(t.TEST('/^application\\/json\\b/.test(xhr.getResponseHeader("Content-Type"))'));

          var response = JSON.parse(xhr.responseText),
            data;
          eval(t.TEST('response.bundle === "bundle"'));
          eval(t.TEST('response.results instanceof Array'));
          eval(t.TEST('response.results.length === 1'));

          eval(t.TEST('response.results[0].options.url === "http://localhost:3000/api"'));
          eval(t.TEST('response.results[0].options.method === "GET"'));
          eval(t.TEST('response.results[0].response.status === 200'));

          data = JSON.parse(response.results[0].response.responseText);
          eval(t.TEST('data.method === "GET"'));
          eval(t.TEST('data.body === null'));

          x.done();
        },
        function() {
          t.test(false, "We shouldn't be here.");
          x.done();
        }
      );
    },
    function test_bundle_of_3(t) {
      var x = t.startAsync('test_bundle_of_3');
      io(
        [
          {
            url: 'http://localhost:3000/api',
            method: 'DELETE',
            query: {a: 1}
          },
          {
            url: 'http://localhost:3000/api',
            method: 'POST',
            query: {b: 2},
            data: [42]
          },
          {
            url: 'http://localhost:3000/api',
            query: {status: 401}
          }
        ],
        function(xhr) {
          eval(t.TEST('xhr.status === 200'));
          eval(t.TEST('/^application\\/json\\b/.test(xhr.getResponseHeader("Content-Type"))'));

          var response = JSON.parse(xhr.responseText),
            data;
          eval(t.TEST('response.bundle === "bundle"'));
          eval(t.TEST('response.results instanceof Array'));
          eval(t.TEST('response.results.length === 3'));

          data = response.results[0];
          eval(t.TEST('data.options.url === "http://localhost:3000/api"'));
          eval(t.TEST('data.options.method === "DELETE"'));
          eval(t.TEST('data.options.query.a === 1'));
          eval(t.TEST('data.response.status === 200'));

          data = JSON.parse(data.response.responseText);
          eval(t.TEST('data.method === "DELETE"'));
          eval(t.TEST('data.body === null'));
          eval(t.TEST('data.query.a === "1"'));

          data = response.results[1];
          eval(t.TEST('data.options.url === "http://localhost:3000/api"'));
          eval(t.TEST('data.options.method === "POST"'));
          eval(t.TEST('data.options.query.b === 2'));
          eval(t.TEST('data.response.status === 200'));

          data = JSON.parse(data.response.responseText);
          eval(t.TEST('data.method === "POST"'));
          eval(t.TEST('data.body === "[42]"'));
          eval(t.TEST('data.query.b === "2"'));

          data = response.results[2];
          eval(t.TEST('data.options.url === "http://localhost:3000/api"'));
          eval(t.TEST('data.options.method === "GET" || !data.options.method'));
          eval(t.TEST('data.options.query.status === 401'));
          eval(t.TEST('data.response.status === 401'));

          data = JSON.parse(data.response.responseText);
          eval(t.TEST('data.method === "GET"'));
          eval(t.TEST('data.body === null'));
          eval(t.TEST('data.query.status === "401"'));

          x.done();
        },
        function() {
          t.test(false, "We shouldn't be here.");
          x.done();
        }
      );
    }
  ]);

  return {};
});
