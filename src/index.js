/*

This file contains a linker for bundles of (redux) actions and reducers,
(redux-saga) selectors and sagas, and (React) views.

A bundle is implemented as a generator that yields linker steps to:

  - include another bundle;
  - declare the use of dependencies defined by other bundles;
  - define an action, selector, or view;
  - add an action reducer or a saga

A bundle's generator function takes as its single argument an object which
the linker populates with the definitions made or used by the bundle.
A shared flat namespace is used for actions, selectors, and views.

Actions are redux actions and have string values.

Selectors are cheap functions that take the global state and extract a limited
view of it.  A selector may be defined in terms of other selectors, and may
also be used in action reducers and sagas.

Multiple action reducers for the same action are currently not supported (an
exception is thrown at link time), but they could be composed in link order.

If a selector match the name of a view name, the view is connected to the
store using the selector.

*/

import {createStore, applyMiddleware, compose} from 'redux';
import createSagaMiddleware from 'redux-saga';
import {delay} from 'redux-saga';
import {call, cancelled, fork} from 'redux-saga/effects';
import {connect} from 'react-redux';

function makeSafeProxy (obj, onError) {
  if (typeof Proxy !== 'function') {
    return obj;
  }
  const safeGet = function (target, property) {
    if (property in target) {
      return target[property];
    } else {
      return onError(target, property);
    }
  }
  return new Proxy(obj, {get: safeGet});
}

export function include (bundle) {
  return {type: 'include', bundle};
};

export function use (...names) {
  return {type: 'use', names};
};

export const def = defineValue;

export function defineValue (name, value) {
  return {type: 'define', name, value};
};

export function defineAction (name, action) {
  return {type: 'defineAction', name, action};
};

export function defineSelector (name, selector) {
  return {type: 'defineSelector', name, selector};
};

export function defineView (name, selector, view) {
  if (view === undefined) {
    view = selector;
    selector = undefined;
  }
  return {type: 'defineView', name, view, selector};
};

// Add an action reducer.
export function addReducer (name, reducer) {
  return {type: 'addReducer', name, reducer};
};

export function addSaga (saga) {
  return {type: 'addSaga', saga};
};

export function addEnhancer (enhancer) {
  return {type: 'addEnhancer', enhancer};
};

export function defer (callback) {
  return {type: 'defer', callback};
};

export function link (rootBundle) {

  // name → value
  const scope = {};

  // Map(action type → action name)
  const nameForActionType = new Map();

  // action name → action reducer
  const reducerMap = new Map();

  const sagas = [];

  const enhancers = [];

  const defers = [];

  // Reducer linking is deferred until all actions have been defined.
  const reducerQueue = [];

  // 'use' directives are queued and dependency objects are populated after
  // all definitions have taken effect.
  const useQueue = [];

  // View linking is defered until all selectors have been added.
  const viewQueue = [];

  const linkErrors = [];

  function undeclaredDependencyError (target, property) {
    throw new Error(`use of undeclared dependency ${property}`);
  }

  const depsBase = {
    get: function (name) {
      return scope[name];
    }
  };

  function include_ (bundle) {
    const base = Object.create(depsBase);
    const deps = makeSafeProxy(base, undeclaredDependencyError);
    let it = bundle(deps);
    try {
      let result = it.next();
      while (!result.done) {
        interpretDirective(result.value, deps);
        result = it.next();
      }
    } catch (ex) {
      console.error(`error ${ex.message} in bundle`, bundle);
      throw ex;
    }
  }

  function defineAction_ (name, action) {
    if (name in scope) {
      throw new Error(`linker conflict on ${name}`);
    }
    if (nameForActionType.has(action)) {
      throw `action type conflict: ${action}`;
    }
    scope[name] = action;
    nameForActionType.set(action, name);
  }

  function define_ (name, value) {
    if (name in scope) {
      throw new Error(`linker conflict on ${name}`);
    }
    scope[name] = value;
  }

  function addReducer_ (name, reducer) {
    if (!(name in scope)) {
      throw new Error(`reducer for undefined action ${name}`);
    }
    const actionType = scope[name];
    if (reducerMap.has(actionType)) {
      const prevReducer = reducerMap.get(actionType);
      reducerMap.set(actionType, function (state, action) {
        return reducer(prevReducer(state, action), action);
      });
    } else {
      reducerMap.set(actionType, reducer);
    }
  }

  function interpretDirective (dir, deps) {
    switch (dir.type) {
      case 'include':
        include_(dir.bundle);
        break;
      case 'use':
        useQueue.push([deps, dir.names]);
        break;
      case 'define':
        define_(dir.name, dir.value);
        useQueue.push([deps, dir.name]);
        break;
      case 'defineAction':
        defineAction_(dir.name, dir.action);
        useQueue.push([deps, dir.name]);
        break;
      case 'defineSelector':
        define_(dir.name, dir.selector);
        useQueue.push([deps, dir.name]);
        break;
      case 'defineView':
        viewQueue.push(dir);
        useQueue.push([deps, dir.name]);
        break;
      case 'addReducer':
        reducerQueue.push(dir);
        break;
      case 'addSaga':
        sagas.push(dir.saga);
        break;
      case 'addEnhancer':
        enhancers.push(dir.enhancer);
        break;
      case 'defer':
        defers.push(dir.callback);
        break;
      default:
        throw `unhandled link directive type ${dir.type}`;
    }
  }

  function provide (deps, name) {
    if (name in scope) {
      deps[name] = scope[name];
    } else {
      throw new Error(`undefined dependency: ${name}`);
    }
  }

  include_(rootBundle);

  // Define reducers.
  reducerQueue.forEach(function (dir) {
    addReducer_(dir.name, dir.reducer);
  });

  // Define and connect views.
  viewQueue.forEach(function (dir) {
    let {name, selector, view} = dir;
    if (selector !== undefined) {
      if (typeof selector === 'string') {
        selector = scope[selector];
      }
    }
    if (typeof selector === 'function') {
      view = connect(selector)(view);
    }
    view.displayName = `View(${name})`;
    scope[name] = view;
  });

  // Provide dependencies.
  useQueue.forEach(function (item) {
    const deps = item[0];
    if (typeof item[1] === 'string') {
      provide(deps, item[1]);
    } else if (Array.isArray(item[1])) {
      item[1].forEach(name => provide(deps, name));
    } else {
      throw new Error('invalid use');
    }
  });

  // Call the deferred callbacks.
  defers.forEach(function (callback) {
    callback.call();
  });

  // Build the reducer.
  const reducer = function (state, action) {
    // TODO: add support for reducer hooks
    if (reducerMap.has(action.type)) {
      state = reducerMap.get(action.type)(state, action);
    }
    return state;
  }

  const sagaMiddleware = createSagaMiddleware();
  let enhancer = applyMiddleware(sagaMiddleware);
  enhancers.forEach(function (other) {
    enhancer = compose(enhancer, other);
  });

  // Create the store.
  const store = createStore(reducer, null, enhancer);

  // Start the sagas.
  function* rootSaga () {
    const task = yield sagas.map(call);
    task.done.catch(function (error) {
      throw error;
    });
  }

  function start () {
    return sagaMiddleware.run(rootSaga);
  }

  return {store, scope, start};
};
