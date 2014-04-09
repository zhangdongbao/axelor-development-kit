/*
 * Axelor Business Solutions
 *
 * Copyright (C) 2012-2014 Axelor (<http://axelor.com>).
 *
 * This program is free software: you can redistribute it and/or  modify
 * it under the terms of the GNU Affero General Public License, version 3,
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
(function(){
	
var ui = angular.module('axelor.ui');

var equals = angular.equals,
	forEach = angular.forEach,
	isArray = angular.isArray,
	isObject = angular.isObject,
	isDate = angular.isDate;

function updateValues(source, target, itemScope, formScope) {
	if (equals(source, target))
		return;

	function compact(value) {
		if (!value) return value;
		if (value.version === undefined) return value;
		if (!value.id) return value;
		var res = _.extend(value);
		res.version = undefined;
		return res;
	};

	forEach(source, function(value, key) {
		if (isDate(value))
			return target[key] = value;
		if (isArray(value)) {
			var dest = target[key] || [];
			value = _.map(value, function(item){
				var found = _.find(dest, function(v){
					return v.id === item.id;
				});
				if (_.has(item, "version") && item.id) item.$fetched = true;
				return found ? _.extend({}, found, item) : item;
			});
			return target[key] = value;
		}
		if (isObject(value)) {
			var dest = target[key] || {};
			if (dest.id === value.id) {
				if (dest.version) {
					dest = _.extend({}, dest);
					updateValues(value, dest, itemScope. formScope);
				} else {
					dest.$updatedValues = value;
					if (formScope) {
						formScope.$broadcast('on:check-nested-values', value);
					}
				}
			} else {
				dest = compact(value);
			}
			return target[key] = dest;
		}
		return target[key] = value;
	});
}

function handleError(scope, item, message) {
	
	if (item == null) {
		return;
	}

	var ctrl = item.data('$ngModelController');
	if (ctrl == null || ctrl.$doReset) {
		return;
	}

	var e = $('<span class="error"></span>').text(message);
	var p = item.parent('td.form-item');

	if (item.children(':first').is(':input,.input-append,.picker-input')) {
		p.append(e);
	} else {
		p.prepend(e);
	}

	var clear = scope.$on('on:edit', function(){
		ctrl.$doReset();
	});
	
	function cleanUp(items) {
		var idx = items.indexOf(ctrl.$doReset);
		if (idx > -1) {
			items.splice(idx, 1);
		}
	}
	
	ctrl.$doReset = function(value) {
		
		cleanUp(ctrl.$viewChangeListeners);
		cleanUp(ctrl.$formatters);
		
		ctrl.$setValidity('invalid', true);
		ctrl.$doReset = null;
		
		e.remove();
		clear();
		
		return value;
	};
	
	if (!item.hasClass('readonly')) {
		ctrl.$setValidity('invalid', false);
	}
	ctrl.$viewChangeListeners.push(ctrl.$doReset);
	ctrl.$formatters.push(ctrl.$doReset);
}

function ActionHandler($scope, ViewService, options) {

	if (options == null || !options.action)
		throw 'No action provided.';

	this.canSave = options.canSave;
	this.prompt = options.prompt;
	this.action = options.action;
	this.element = options.element || $();

	this.scope = $scope;
	this.ws = ViewService;
}

ActionHandler.prototype = {
	
	constructor: ActionHandler,
	
	onLoad : function() {
		return this.handle();
	},
	
	onNew: function() {
		return this.handle();
	},
	
	onSave: function() {
		return this.handle();
	},
	
	onSelect: function() {
		return this.handle();
	},
	
	onClick: function(event) {
		var self = this;
		if (this.prompt) {
			var deferred = this.ws.defer(),
				promise = deferred.promise;
			axelor.dialogs.confirm(this.prompt, function(confirmed){
				if (confirmed) {
					self.handle().then(deferred.resolve, deferred.reject);
				} else {
					deferred.reject();
				}
			}, {
				yesNo: false
			});
			return promise;
		}
		return this.handle();
	},

	onChange: function(event) {
		var deferred = this.ws.defer(),
			promise = deferred.promise;

		var self = this;
		setTimeout(function(){
			self.handle().then(deferred.resolve, deferred.reject);
		});
		return promise;
	},
	
	_getContext: function() {
		var scope = this.scope,
			context = scope.getContext ? scope.getContext() : scope.record,
			viewParams = scope._viewParams || {};
		
		context = _.extend({}, viewParams.context, context);

		// include button name as _signal (used by workflow engine)
		if (this.element.is("button,a.button-item")) {
			context['_signal'] = this.element.attr('name');
		}

		return context;
	},
	
	_getFormElement: function () {
		var formElement = this.element.parents('form:first');
		if (!formElement.get(0)) { // toolbar button
			formElement = this.element.parents('.form-view:first').find('form:first');
		}
		if (formElement.length == 0) {
			formElement = this.element;
		}
		return formElement;
	},

	handle: function() {
		var action = this.action.trim();
		return this._handleAction(action);
	},
	
	_blockUI: function() {
		// block the entire ui (auto unblocks when actions are complete)
		_.delay(axelor.blockUI, 100);
	},
	
	_handleSave: function() {

		this._blockUI();

		var scope = this.scope,
			deferred = this.ws.defer();

		if (scope.isValid && !scope.isValid()) {
			if (scope.showErrorNotice) {
				scope.showErrorNotice();
			} else {
				axelor.notify.error(_t('Please correct the invalid form values.'), {
					title: _t('Validation error')
				});
			}
			deferred.reject();
			return deferred.promise;
		}
		if (scope.isDirty && !scope.isDirty()) {
			deferred.resolve();
			return deferred.promise;
		}

		function doEdit(rec) {
			var params = scope._viewParams || {};
			scope.editRecord(rec);
			if (params.$viewScope) {
				params.$viewScope.updateRoute();
			}
			deferred.resolve();
		}
		
		function doSave(values) {
			var ds = scope._dataSource;
			ds.save(values).success(function(rec, page) {
				if (scope.doRead) {
					return scope.doRead(rec.id).success(doEdit);
				}
				return ds.read(rec.id).success(doEdit);
			});
		}
		
		var values = _.extend({ _original: scope.$$original }, scope.record);
		if (scope.onSave) {
			scope.onSave({
				values: values,
				callOnSave: false
			}).then(function () {
				deferred.resolve();
			});
		} else {
			doSave(values);
		}

		this._invalidateContext = true;
		return deferred.promise;
	},

	_handleAction: function(action) {

		this._blockUI();
		
		var self = this,
			scope = this.scope,
			context = this._getContext(),
			deferred = this.ws.defer();

		function resolveLater() {
			deferred.resolve();
			return deferred.promise;
		}
		
		function chain(items) {
			var first = _.first(items);
			if (first === undefined) {
				return resolveLater();
			}
			return self._handleSingle(first).then(function(pending) {
				if (_.isString(pending)) {
					return self._handleAction(pending);
				}

				scope.$timeout(function () {
					scope.ajaxStop(function() {
						deferred.resolve();
					});
				});

				return deferred.promise.then(function () {
					return chain(_.rest(items));
				});
			});
		}

		if (!action) {
			return resolveLater();
		}
		
		var pattern = /(^sync\s*,\s*)|(^sync$)/;
		if (pattern.test(action)) {
			action = action.replace(pattern, '');
			var formElement = this._getFormElement();
			var formScope = formElement.scope();
			var event = formScope.$broadcast('on:before-save');
			if (event.defaultPrevented) {
				if (event.error) {
					axelor.dialogs.error(event.error);
				}
				setTimeout(function() {
					deferred.reject(event.error);
				});
				return deferred.promise;
			}
			return self._handleAction(action);
		}

		if (action === 'save') {
			return this._handleSave();
		}

		if (this._invalidateContext) {
			context = this._getContext();
			this._invalidateContext = false;
		}

		var model = context._model || scope._model;
		var promise = this.ws.action(action, model, context).then(function(response){
			var resp = response.data,
				data = resp.data || [];
			if (resp.errors) {
				data.splice(0, 0, {
					errors: resp.errors
				});
			}
			return chain(data);
		});

		promise.then(function(){
			deferred.resolve();
		});
		
		return deferred.promise;
	},

	_handleSingle: function(data) {

		var deferred = this.ws.defer();

		if (data == null || data.length == 0) {
			deferred.resolve();
			return deferred.promise;
		}

		var self = this,
			scope = this.scope,
			formElement = this._getFormElement(),
			formScope = formElement.data('$scope') || scope;

		if(data.flash || data.info) {
			axelor.dialogs.say(data.flash || data.info);
		}

		if(data.notify) {
			axelor.notify.info(data.notify);
		}

		if(data.error) {
			axelor.dialogs.error(data.error, function(){
				scope.applyLater(function(){
					if (data.action) {
						self._handleAction(data.action);
					}
					deferred.reject();
				});
			});
			return deferred.promise;
		}
		
		if (data.alert) {
			axelor.dialogs.confirm(data.alert, function(confirmed){
				scope.applyLater(function(){
					if (confirmed) {
						return deferred.resolve(data.pending);
					}
					if (data.action) {
						self._handleAction(data.action);
					}
					deferred.reject();
				});
			}, {
				title: _t('Warning'),
				yesNo: false
			});
			
			return deferred.promise;
		}
		
		if (!_.isEmpty(data.errors)) {
			_.each(data.errors, function(v, k){
				var item = (findItems(k) || $()).first();
				handleError(scope, item, v);
			});
			deferred.reject();
			return deferred.promise;
		}
		
		if (data.values) {
			updateValues(data.values, scope.record, scope, formScope);
			if (scope.onChangeNotify) {
				scope.onChangeNotify(scope, data.values);
			}
			this._invalidateContext = true;
			axelor.$adjustSize();
		}
		
		if (data.reload) {
			this._invalidateContext = true;
			var promise = scope.reload(true);
			if (promise) {
				promise.then(function(){
					deferred.resolve(data.pending);
				});
			}
			return deferred.promise;
		}
		
		if (data.save) {
			scope.$timeout(function () {
				self._handleSave().then(function(){
					scope.ajaxStop(function () {
						deferred.resolve(data.pending);
					}, 100);
				});
			});
			return deferred.promise;
		}
		
		if (data.signal) {
			formScope.$broadcast(data.signal, data['signal-data']);
		}
		
		if (data.exportFile) {
			(function () {
				var link = "ws/files/data-export/" + data.exportFile;
				var frame = $('<iframe>').appendTo('body').hide();
				frame.attr("src", link);
				setTimeout(function(){
					frame.attr("src", "");
					frame.remove();
					frame = null;
				}, 5000);
			})();
		}

		function findItems(name) {

			var items;
			var containers = formElement.parents('.form-view:first')
										.find('.record-toolbar:first')
										.add(formElement);

			// first search by nested x-path
			if (scope.formPath) {
				items = containers.find('[x-path="' + scope.formPath + '.' + name + '"]');
				if (items.size()) {
					return items;
				}
			}
			
			// then search by x-path
			items = containers.find('[x-path="' + name + '"]');
			if (items.size()) {
				return items;
			}
		
			// else search by name
			items = containers.find('[name="' + name +'"]');
			if (items.size()) {
				return items;
			}
		}
		
		function setAttrs(item, itemAttrs, itemIndex) {
			
			var label = item.data('label'),
				itemScope = item.data('$scope'),
				column;

			// handle o2m/m2m columns
			if (item.is('.slick-dummy-column')) {
				column = item.data('column');
				itemScope = item.parents('[x-path]:first').data('$scope');
				forEach(itemAttrs, function(value, attr){
					if (attr == 'hidden')
						itemScope.showColumn(column.id, !value);
					if (attr == 'title')
						setTimeout(function(){
							itemScope.setColumnTitle(column.id, value);
						});
				});
				return;
			}
			
			//handle o2m/m2m title
			if(item.is('.one2many-item') || item.is('.many2many-item')){
				forEach(itemAttrs, function(value, attr){
					if (attr == 'title') {
						itemScope.title = value;
					}
				});
			}

			// handle notebook
			if (item.is('.tab-pane')) {
				forEach(itemAttrs, function(value, attr){
					if (attr == 'hidden') {
						itemScope.attr('hidden', value);
					}
					if (attr == 'title') {
						itemScope.title = value;
					}
				});
				return;
			}

			forEach(itemAttrs, function(value, attr){
				
				if (itemIndex > 0 && attr && (attr === "value" || attr.indexOf("value:") === 0)) {
					return;
				}
				
				switch(attr) {
				case 'required':
					itemScope.attr('required', value);
					break;
				case 'readonly':
					itemScope.attr('readonly', value);
					break;
				case 'hidden':
					itemScope.attr('hidden', value);
					break;
				case 'collapse':
					itemScope.attr('collapse', value);
					break;
				case 'title':
					if (label) {
						label.html(value);
					} else if (item.is('label')) {
						item.html(value);
					}
					itemScope.attr('title', value);
					break;
				case 'color':
					//TODO: set color
				case 'domain':
					if (itemScope.setDomain)
						itemScope.setDomain(value);
					break;
				case 'refresh':
					itemScope.$broadcast('on:attrs-change:refresh');
					break;
				case 'url':
				case 'url:set':
					if (item.is('[ui-portlet]')) {
						item.find('iframe:first').attr('src', value);
					}
					break;
				case 'value':
				case 'value:set':
					if (itemScope.setValue) {
						itemScope.setValue(value);
					}
					break;
				case 'value:add':
					if (itemScope.fetchData && itemScope.select) {
						itemScope.fetchData(value, function(records){
							itemScope.select(records);
						});
					}
					break;
				case 'value:del':
					if (itemScope.removeItems) {
						itemScope.removeItems(value);
					}
					break;
				}
			});
		}
		
		forEach(data.attrs, function(itemAttrs, itemName) {
			var items = findItems(itemName);
			if (items == null || items.length == 0) {
				return;
			}
			items.each(function(i) {
				setAttrs($(this), itemAttrs, i);
			});
		});
		
		function openTab(scope, tab) {
			if (scope.openTab) {
				scope.openTab(tab);
			} else if (scope.$parent) {
				openTab(scope.$parent, tab);
			}
		}

		if (data.view) {
			var tab = data.view;
			tab.action = _.uniqueId('$act');
			if (!tab.viewType)
				tab.viewType = 'grid';
			if (tab.viewType == 'grid' || tab.viewType == 'form')
				tab.model = tab.model || tab.resource;
			if (!tab.views) {
				tab.views = [{ type: tab.viewType }];
				if (tab.viewType === 'html') {
					angular.extend(tab.views[0], {
						resource: tab.resource,
						title: tab.title
					});
				}
			}
			if (tab.viewType == 'form' || tab.viewType == 'grid') {
				var views = _.groupBy(tab.views, 'type');
				if (!views.grid) tab.views.push({type: 'grid'});
				if (!views.form) tab.views.push({type: 'form'});
			}
			
			if (tab.params && tab.params.popup) {
				tab.$popupParent = formScope;
			}
			openTab(scope, tab);
			scope.applyLater();
		}
		
		if (data.canClose) {
			if (scope.onOK) {
				scope.onOK();
			}
		}

		deferred.resolve();
		
		return deferred.promise;
	}
};

ui.factory('ActionService', ['ViewService', function(ViewService) {
	
	function handler(scope, element, options) {
		var opts = _.extend({}, options, { element: element });
		return new ActionHandler(scope, ViewService, opts);
	}
	
	return {
		handler: handler
	};
}]);

var EVENTS = ['onClick', 'onChange', 'onSelect', 'onNew', 'onLoad', 'onSave'];

ui.directive('uiActions', ['ViewService', function(ViewService) {

	function link(scope, element, attrs) {

		var props = _.isEmpty(scope.field) ? scope.schema : scope.field;
		if (props == null)
			return;

		_.each(EVENTS, function(name){
			var action = props[name];
			if (action == null) {
				return;
			}
			
			var handler = new ActionHandler(scope, ViewService, {
				element: element,
				action: action,
				canSave: props.canSave,
				prompt: props.prompt
			});
			scope.$events[name] = _.bind(handler[name], handler);
		});
	}
	
	return {
		link: function(scope, element, attrs) {
			scope.$evalAsync(function() {
				link(scope, element, attrs);
			});
		}
	};
}]);

}).call(this);
