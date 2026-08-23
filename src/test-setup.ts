// jsdom implements the DOM, not the parts of a browser that involve an actual
// viewport. Components that keep the selection visible call scrollIntoView, so
// it needs to exist — there is nothing to scroll and nothing to assert about
// it, only a function that must not throw.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
