define([
	'require',
	'./watch',
	'./handlers',
	'./util',
	'../has'
], function(require, watch, handlers, util, has){
	has.add('native-xhr', function() {
		// if true, the environment has a native XHR implementation
		return typeof XMLHttpRequest !== 'undefined';
	});

	has.add('native-xhr2', function(){
		if(!has('native-xhr')){ return; }
		var x = new XMLHttpRequest();
		return typeof x['addEventListener'] !== 'undefined';
	});

	function handleResponse(response){
		var _xhr = response.xhr;
		response.status = response.xhr.status;
		response.text = _xhr.responseText;

		if(response.options.handleAs === 'xml'){
			response.data = _xhr.responseXML;
		}

		try{
			handlers(response);
		}catch(e){
			response.error = e;
		}

		if(response.error){
			this.reject(response.error);
		}else if(util.checkStatus(_xhr.status)){
			this.resolve(response);
		}else{
			var err = new Error('Unable to load ' + response.url + ' status: ' + _xhr.status);
			err.log = false;

			this.reject(err);
		}
	}

	var isValid, isReady, addListeners, cancel;
	if(has('native-xhr2')){
		// Any platform with XHR2 will only use the watch mechanism for timeout.

		isValid = function(response){
			// summary: Check to see if the request should be taken out of the watch queue
			return !this._finished;
		};
		cancel = function(dfd, response){
			// summary: Canceler for deferred
			response.xhr.abort();
		};
		addListeners = function(_xhr, dfd, response){
			// summary: Adds event listeners to the XMLHttpRequest object
			function onLoad(evt){
				dfd._finished = 1;
				dfd.handleResponse(response);
			}
			function onError(evt){
				dfd._finished = 1;

				var _xhr = evt.target;
				response.error = new Error('Unable to load ' + response.url + ' status: ' + _xhr.status); 
				response.error.log = false;

				dfd.handleResponse(response);
			}
			function onAbort(evt){
				dfd._finished = 1;
			}

			function onProgress(evt){
				if(evt.lengthComputable){
					response.loaded = evt.loaded;
					response.total = evt.total;
					dfd.progress(response);
				}
			}

			_xhr.addEventListener('load', onLoad, false);
			_xhr.addEventListener('error', onError, false);
			_xhr.addEventListener('abort', onAbort, false);
			_xhr.addEventListener('progress', onProgress, false);

			return function(){
				_xhr.removeEventListener('load', onLoad, false);
				_xhr.removeEventListener('error', onError, false);
				_xhr.removeEventListener('abort', onAbort, false);
				_xhr.removeEventListener('progress', onProgress, false);
			};
		};
	}else{
		isValid = function(response){
			return response.xhr.readyState; //boolean
		};
		isReady = function(response){
			return 4 === response.xhr.readyState; //boolean
		};
		cancel = function(dfd, response){
			// summary: canceller function for util.deferred call.
			var xhr = response.xhr;
			var _at = typeof xhr.abort;
			if(_at === 'function' || _at === 'object' || _at === 'unknown'){
				xhr.abort();
			}
		};
	}

	var undefined,
		defaultOptions = {
			data: null,
			query: null,
			sync: false,
			method: 'GET',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			}
		};
	function xhr(/*String*/ url, /*Object?*/ options, /*Boolean?*/ returnDeferred){
		//	summary:
		//		Sends an HTTP request with the given URL and options.
		//	description:
		//		Sends an HTTP request with the given URL.
		//	url:
		//		URL to request
		var response = util.parseArgs(url, util.deepCreate(defaultOptions, options));
		url = response.url;
		options = response.options;

		var remover,
			last = function(){
				remover && remover();
			};

		//Make the Deferred object for this xhr request.
		var dfd = util.deferred(
			response,
			cancel,
			isValid,
			isReady,
			handleResponse,
			last
		);
		var _xhr = response.xhr = xhr._create();

		//If XHR factory fails, cancel the deferred.
		if(!_xhr){
			dfd.cancel();
			return returnDeferred ? dfd : dfd.promise;
		}

		if(addListeners){
			remover = addListeners(_xhr, dfd, response);
		}

		var data = options.data,
			async = !options.sync,
			method = options.method;

		// IE6 won't let you call apply() on the native function.
		_xhr.open(method, url, async, options.user || undefined, options.password || undefined);

		var headers = options.headers,
			contentType;
		if(headers){
			for(var hdr in headers){
				if(hdr.toLowerCase() === 'content-type'){
					contentType = headers[hdr];
				}else if(headers[hdr]){
					//Only add header if it has a value. This allows for instance, skipping
					//insertion of X-Requested-With by specifying empty value.
					_xhr.setRequestHeader(hdr, headers[hdr]);
				}
			}
		}

		if(contentType && contentType !== false){
			_xhr.setRequestHeader('Content-Type', contentType);
		}
		if(!headers || !('X-Requested-With' in headers)){
			_xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
		}

		try{
			var notify = require('./notify');
			notify.send(response);
		}catch(e){}
		try{
			_xhr.send(data);
		}catch(e){
			response.error = e;
			dfd.reject(e);
		}

		watch(dfd);
		_xhr = null;

		return returnDeferred ? dfd : dfd.promise;
	}

	xhr._create = function(){
		// summary:
		//		does the work of portably generating a new XMLHTTPRequest object.
		throw new Error('XMLHTTP not available');
	};
	if(has('native-xhr')){
		xhr._create = function(){
			return new XMLHttpRequest();
		};
	}else if(has('activex')){
		try{
			new ActiveXObject('Msxml2.XMLHTTP');
			xhr._create = function(){
				return new ActiveXObject('Msxml2.XMLHTTP');
			};
		}catch(e){
			try{
				new ActiveXObject('Microsoft.XMLHTTP');
				xhr._create = function(){
					return new ActiveXObject('Microsoft.XMLHTTP');
				};
			}catch(e){}
		}
	}

	util.addCommonMethods(xhr);

	return xhr;
});
