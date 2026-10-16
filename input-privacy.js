(() => {
  const controlSelector = 'input:not([type="hidden"]), textarea, select';

  function disableHistorySuggestions(element) {
    if (!(element instanceof Element)) return;
    if (element.matches('form')) element.setAttribute('autocomplete', 'off');
    if (element.matches(controlSelector)) element.setAttribute('autocomplete', 'off');
    element.querySelectorAll('form').forEach((form) => form.setAttribute('autocomplete', 'off'));
    element.querySelectorAll(controlSelector).forEach((control) => control.setAttribute('autocomplete', 'off'));
  }

  disableHistorySuggestions(document.documentElement);
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach(disableHistorySuggestions));
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Reassert the policy immediately before a control receives user input.
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element && event.target.matches(controlSelector)) {
      event.target.setAttribute('autocomplete', 'off');
    }
  }, true);
})();
