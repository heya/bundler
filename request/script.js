define([
	'module',
	'require',
	'./watch',
	'./util',
	'../_base/array',
	'../_base/lang',
	'../on',
	'../dom',
	'../dom-construct',
	'../has',
	'../_base/window'
], function(module, require, watch, util, array, lang, on, dom, domConstruct, has, win){
	has.add('script-readystatechange', function(global, document){
		var script = document.createElement('script');
		return typeof script['onreadystatechange'] !== 'undefined' &&
			(typeof global['opera'] === 'undefined' || global['opera'].toString() !== '[object Opera]');
	});

	var mid = module.id.replace(/[\/\.\-]/g, '_'),
		counter = 0,
		loadEvent = has('script-readystatechange') ? 'readystatechange' : 'load',
		readyRegExp = /complete|loaded/,
		callbacks = this[mid + '_callbacks'] = {},
		deadScripts = [];

	var noop = { _jsonpCallback: function(){} };
	function jsonpCallback(json){
		this.response.data = json;
	}

	function attach(id, url, frameDoc){
		var doc = (frameDoc || win.doc),
			element = doc.createElement('script');

		element.type = 'text/javascript';
		element.src = url;
		element.id = id;
		element.async = true;
		element.charset = 'utf-8';

		return doc.getElementsByTagName('head')[0].appendChild(element);
	}

	function remove(id, frameDoc, noopCallback){
		domConstruct.destroy(dom.byId(mid + id, frameDoc));

		if(callbacks[id]){
			if(noopCallback){
				callbacks[id] = noop;
			}else{
				delete callbacks[id];
			}
		}
	}

	function _addDeadScript(dfd){
		var response = dfd.response;
		deadScripts.push({ id: dfd.id, frameDoc: response.options.frameDoc });
		response.options.frameDoc = null;
	}

	function canceler(dfd, response){
		if(dfd.canDelete){
			//For timeouts and cancels, remove the script element immediately to
			//avoid a response from it coming back later and causing trouble.
			script._remove(dfd.id, response.options.frameDoc, true);
		}
	}
	function isValid(response){
		//Do script cleanup here. We wait for one inflight pass
		//to make sure we don't get any weird things by trying to remove a script
		//tag that is part of the call chain (IE 6 has been known to
		//crash in that case).
		if(deadScripts && deadScripts.length){
			array.forEach(deadScripts, function(_script){
				script._remove(_script.id, _script.frameDoc);
				_script.frameDoc = null;
			});
			deadScripts = [];
		}

		return true;
	}
	function isReadyJsonp(response){
		return !!response.data;
	}
	function isReadyScript(response){
		return !!this.scriptLoaded;
	}
	function isReadyCheckString(response){
		var checkString = response.options.checkString;

		return checkString && eval('typeof(' + checkString + ') !== "undefined"');
	}
	function handleResponse(response){
		if(this.canDelete){
			_addDeadScript(this);
		}
		if(response.error){
			this.reject(response.error);
		}else{
			this.resolve(response);
		}
	}

	function script(url, options, returnDeferred){
		var response = util.parseArgs(url, util.deepCopy({}, options));
		url = response.url;
		options = response.options;

		var dfd = util.deferred(
			response,
			canceler,
			isValid,
			options.jsonp ? isReadyJsonp : (options.checkString ? isReadyCheckString : isReadyScript),
			handleResponse
		);

		lang.mixin(dfd, {
			id: counter++,
			canDelete: false
		});
		dfd.scriptId = mid + dfd.id;

		if(options.jsonp){
			url += (~url.indexOf('?') ? '&' : '?') +
				options.jsonp + '=' +
				(options.frameDoc ? 'parent.' : '') +
				mid + '_callbacks[' + dfd.id + ']._jsonpCallback';

			dfd.canDelete = true;
			callbacks[dfd.id] = {
				_jsonpCallback: jsonpCallback,
				response: response
			};
		}

		try{
			var notify = require('./notify');
			notify.send(response);
		}catch(e){}
		var node = script._attach(dfd.scriptId, url, options.frameDoc);

		if(!options.jsonp && !options.checkString){
			var handle = on(node, loadEvent, function(evt){
				if(evt.type === 'load' || readyRegExp.test(node.readyState)){
					handle.remove();
					dfd.scriptLoaded = evt;
				}
			});
		}

		watch(dfd);

		return returnDeferred ? dfd : dfd.promise;
	}
	script.get = script;

	// TODO: Remove in 2.0
	script._attach = attach;
	script._remove = remove;

	return script;
});
