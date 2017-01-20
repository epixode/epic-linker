
import {connect} from 'react-redux';
import {call} from 'redux-saga/effects';

import {makeSafeProxy, directCompose, reverseCompose} from './utils';

export default Bundle;

function undeclaredDependencyError (target, property) {
  throw new Error(`use of undeclared dependency ${property}`);
}

function Bundle (linker, builder) {
  this.builder = builder;
  this.locals = makeSafeProxy({}, undeclaredDependencyError);
  this._ = {
    linker: linker,
    bundles: [],
    earlyReducers: [],
    actionReducers: [],
    lateReducers: [],
    views: [],
    defers: [],
    sagas: [],
    sealed: false
  };
}

Bundle.prototype.include = function (builder) {
  this._assertNotSealed();
  const bundle = new Bundle(this._.linker, builder);
  this._.bundles.push(bundle);
  builder(bundle, bundle.locals);
  return bundle.locals;
};

Bundle.prototype.use = function (...names) {
  this._assertNotSealed();
  this._.linker.declareUse(this.locals, names);
};

Bundle.prototype.pack = function (...names) {
  this._assertNotSealed();
  const target = makeSafeProxy({}, undeclaredDependencyError);
  this._.linker.declareUse(target, names);
  return target;
};

Bundle.prototype.defineValue = function (name, value) {
  this._assertNotSealed();
  this._.linker.publish('value', name, value);
  this.use(name);
};

Bundle.prototype.defineSelector = function (name, value) {
  this._assertNotSealed();
  this._.linker.publish('selector', name, value);
  this.use(name);
};

Bundle.prototype.defineAction = function (name, actionType) {
  this._assertNotSealed();
  this._.linker.declareActionType(actionType, name);
  this._.linker.publish('action', name, actionType);
  this.use(name);
};

Bundle.prototype.defineView = function (name, selector, view) {
  this._assertNotSealed();
  if (view === undefined) {
    view = selector;
    selector = undefined;
  }
  this.use(name);
  this._.views.push({name, view, selector});
};

Bundle.prototype.addReducer = function (name, reducer) {
  this._assertNotSealed();
  if (reducer === undefined) {
    this._.lateReducers.push(name); // name is the reducer function
  } else {
    this.use(name);
    this._.actionReducers.push({name, reducer});
  }
};

Bundle.prototype.addEarlyReducer = function (reducer) {
  this._assertNotSealed();
  this._.earlyReducers.push(reducer);
};

Bundle.prototype.addLateReducer = function (reducer) {
  this._assertNotSealed();
  this._.lateReducers.push(reducer);
};

Bundle.prototype.addSaga = function (saga) {
  this._assertNotSealed();
  this._.sagas.push(saga);
};

Bundle.prototype.addEnhancer = function (enhancer) {
  this._assertNotSealed();
  this._.linker.addEnhancer(enhancer);
};

Bundle.prototype.defer = function (callback) {
  this._assertNotSealed();
  this._.defers.push(callback);
};

Bundle.prototype.lookup = function (name) {
  return this._.linker.lookup(name);
};

/* TODO: hide this Bundle methods */

Bundle.prototype._assertNotSealed = function () {
  if (this._.sealed) {
    throw new Error('Dynamically calling epic-linker directives is not supported.');
  }
};

Bundle.prototype._linkViews = function () {
  var i;
  // Define and connect views.
  for (i = 0; i < this._.views.length; i += 1) {
    let {name, selector, view} = this._.views[i];
    if (selector !== undefined) {
      if (typeof selector === 'string') {
        selector = this.locals[selector];
      }
      if (typeof selector !== 'function') {
        throw new Error(`invalid selector for view`, name);
      }
      view = connect(selector)(view);
    }
    view.displayName = `View(${name})`;
    this._.linker.publish('view', name, view);
  }
  // Define and connect views in included bundles.
  for (i = 0; i < this._.bundles.length; i += 1) {
    this._.bundles[i]._linkViews();
  }
};

Bundle.prototype._runDefers = function () {
  var i;
  // The bundle's defers run first,
  for (i = 0; i < this._.defers.length; i += 1) {
    this._.defers[i].call();
  }
  // followed by the defers in included bundles.
  for (i = 0; i < this._.bundles.length; i += 1) {
    this._.bundles[i]._runDefers();
  }
};

Bundle.prototype._earlyReducer = function () {
  const reducers = this._.earlyReducers.concat(
    this._.bundles.map(bundle => bundle._earlyReducer()));
  // [x1,…,xn].reduce(f, a) = f(f(f(a,x1), …), xn)
  // Use directCompose so that early-reducers added first apply first.
  return reducers.reduce(reverseCompose, null);
};

Bundle.prototype._buildActionMap = function (actionMap) {
  var i;
  for (i = 0; i < this._.actionReducers.length; i += 1) {
    const {name, reducer} = this._.actionReducers[i];
    const actionType = this.locals[name];
    const prevReducer = actionMap.get(actionType);
    actionMap.set(actionType, reverseCompose(prevReducer, reducer));
  }
  for (i = 0; i < this._.bundles.length; i += 1) {
    this._.bundles[i]._buildActionMap(actionMap);
  }
};

Bundle.prototype._lateReducer = function () {
  const reducers = this._.lateReducers.concat(
    this._.bundles.map(bundle => bundle._lateReducer()));
  // [x1,…,xn].reduce(f, a) = f(f(f(a,x1), …), xn)
  // Use directCompose so that late-reducers added first apply last.
  return reducers.reduce(directCompose, null);
};

Bundle.prototype._saga = function () {
  var i;
  const effects = [];
  for (i = 0; i < this._.sagas.length; i += 1) {
    effects.push(call(this._.sagas[i]));
  }
  for (i = 0; i < this._.bundles.length; i += 1) {
    effects.push(call(this._.bundles[i]._saga()));
  }
  return function* () {
    yield effects;
  };
};

Bundle.prototype._seal = function () {
  var i;
  this._.sealed = true;
  for (i = 0; i < this._.bundles.length; i += 1) {
    this._.bundles[i]._seal();
  }
};
