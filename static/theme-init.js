(function () {
  'use strict';
  var preference = 'system';
  try {
    var saved = window.localStorage.getItem('researchbench:theme');
    if (saved === 'system' || saved === 'light' || saved === 'dark') preference = saved;
  } catch (_) {
    // The system preference still works when browser storage is unavailable.
  }
  document.documentElement.dataset.theme = preference;
})();
