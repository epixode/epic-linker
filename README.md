
# Usage

This package supports modular applications based on react and redux-saga.

## Bundles

A *bundle* is defined by a generator yielding directives:

    function* myBundle () {
      yield …;
      …
    }

Directives are built using directive-builder functions exported by this
package.

The 'include' builder can be used inside a bundle to include another
bundle:

    yield include(myBundle);

The linker makes no attempt at detecting or avoiding double-inclusion.

## Dependencies

A bundle can declare dependencies (actions, selectors, views) on linked
bundles with the 'use' builder, applied to any number of names:

    function* myBundle (deps) {
      yield use('myAction', 'mySelector', 'MyView');
      /* use as deps.myAction, deps.mySelector, deps.MyView */
    }

A bundle can depend on its own definitions.

## Definitions

### Action types

Action types are defined with the 'defineAction' builder, which takes
the action type name and value.  The name is used internally (it names
a property of `deps`), the value is the string representation actually
in redux actions.

    yield defineAction('name', 'String.Representation');

### Selectors

Selectors are defined with the 'defineSelector' builder, which takes the
selector name and function:

    yield defineSelector('mySelector', function (state, props) {
      …
    });

### Views

Views are defined with the 'defineView' builder, which takes the view
name, an optional selector name, and React class or function:

    yield defineView('TodoList', 'getTodoItems', TodoView);
    yield defineView('App', AppView);

The selector, if specified, is automatically attached to view instances
and allows it to extract properties from the redux store.

## Reducers

Reducers are added with the 'addReducer' builder which takes an action
name and a reducer function:

    yield addReducer('myAction', function (state, action) {
      return {state, …};
    });

The store reducer generated by the linker dispatches actions to their
individual action-reducer.  If multiple action-reducers are added for
the same action, they are all applied following the link order.

## Sagas

Sagas are added with the 'addSaga' builder:

    yield addSaga (function* mySaga () {
      …
    });

## Enhancer

Store enhancers can be added with the 'addEnhancer' linker directive:

    yield addEnhancer(DevTools.instrument());

Enhancers are composed in link order.
