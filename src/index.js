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
import {default as createSagaMiddleware} from 'redux-saga';

import {makeSafeProxy, reverseCompose} from './utils';
import Bundle from './bundle';

export default function link (rootBuilder) {

  // The global namespace map (name → value)
  const globalScope = {};

  // Type map (value|selector|action|view) used to stage injections.
  const typeMap = new Map();

  // Map(action type → action name)
  const nameForActionType = new Map();

  // Enhancers have a flat structure.
  const enhancers = [];

  // 'use' directives are queued and dependency objects are populated after
  // all definitions have taken effect.
  const useQueue = [];

  const linkErrors = [];

  function undefinedNameError (target, property) {
    throw new Error(`use of undefined name ${property}`);
  }

  function declareActionType (actionType, name) {
    if (nameForActionType.has(actionType)) {
      throw new Error(`action type conflict: ${actionType}`);
    }
    nameForActionType.set(actionType, name);
  }

  function declareUse (target, names) {
    useQueue.push([target, names]);
  }

  function addEnhancer (enhancer) {
    enhancers.push(enhancer);
  }

  /* Publish a value in the global scope. */
  function publish (type, name, value) {
    if (name in globalScope) {
      throw new Error(`linker conflict on ${name}`);
    }
    typeMap.set(name, type);
    globalScope[name] = value;
  }

  /* Look up a value in the global scope. */
  function lookup (name) {
    return globalScope[name];
  }

  /* Inject a value into a local scope. */
  function inject (typeFilter, locals, name) {
    if (typeFilter) {
      const type = typeMap.get(name);
      if (-1 === typeFilter.indexOf(type)) {
        return;
      }
    }
    if (name in globalScope) {
      locals[name] = globalScope[name];
    } else {
      throw new Error(`undefined dependency: ${name}`);
    }
  }

  /* Inject all values in all local scopes. */
  function injectAll (typeFilter) {
    for (let i = 0; i < useQueue.length; i += 1) {
      const dir = useQueue[i], locals = dir[0], arg = dir[1];
      if (typeof arg === 'string') {
        inject(typeFilter, locals, arg);
      } else if (Array.isArray(arg)) {
        for (let name of arg) {
          inject(typeFilter, locals, name);
        }
      } else {
        throw new Error('invalid use');
      }
    }
  }

  // Call the root builder with a root bundle.
  // This will directly defines all actions and selectors.
  const linker = {publish, declareUse, declareActionType, addEnhancer, lookup};
  const rootBundle = new Bundle(linker, rootBuilder);
  rootBuilder(rootBundle, rootBundle.locals);

  // Seal the bundles to ensure all linking is done statically.
  rootBundle._seal();

  /* Views can depend on selector definitions, so inject them in a second phase. */
  injectAll(['action', 'selector', 'value']);
  rootBundle._linkViews();
  injectAll('views');

  // Compose the reducer now that all actions have been defined.
  const actionMap = new Map();
  rootBundle._buildActionMap(actionMap);
  const actionReducer = function (state, action) {
    if (actionMap.has(action.type)) {
      state = actionMap.get(action.type)(state, action);
    }
    return state;
  };
  const reducer = [
    rootBundle._earlyReducer(),
    actionReducer,
    rootBundle._lateReducer()
  ].reduce(reverseCompose, null);

  // Compose the enhancers.
  const sagaMiddleware = createSagaMiddleware();
  let enhancer = applyMiddleware(sagaMiddleware);
  for (let other of enhancers) {
    enhancer = compose(enhancer, other);
  }

  // Create the store.
  const store = createStore(reducer, null, enhancer);

  function finalize (...args) {
    /* Call the deferred callbacks. */
    rootBundle._runDefers(...args);
  }

  /* Collect the sagas.  The root task is returned, suggested use is:

      start().done.catch(function (error) {
        // notify user that the application has crashed and offer
        // to restart it by calling start() again.
      });

   */
  const rootSaga = rootBundle._saga();
  function start () {
    return sagaMiddleware.run(rootSaga);
  }

  return {
    scope: makeSafeProxy(globalScope, undefinedNameError),
    store,
    reducer,
    finalize,
    start
  };
};
