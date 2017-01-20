
export function makeSafeProxy (obj, onError) {
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

export function directCompose (secondReducer, firstReducer) {
  if (!firstReducer) {
    return secondReducer;
  }
  if (!secondReducer) {
    return firstReducer;
  }
  return (state, action) => secondReducer(firstReducer(state, action), action);
}

export function reverseCompose (firstReducer, secondReducer) {
  if (!firstReducer) {
    return secondReducer;
  }
  if (!secondReducer) {
    return firstReducer;
  }
  return (state, action) => secondReducer(firstReducer(state, action), action);
}
