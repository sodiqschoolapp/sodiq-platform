
(function () {
  var KEY = 'istirohat-kit-ticks';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var fill = document.getElementById('fill');
  var count = document.getElementById('count');
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function render() {
    var done = 0;
    steps.forEach(function (li) {
      var on = !!state[li.dataset.id];
      li.querySelector('input').checked = on;
      li.classList.toggle('done', on);
      if (on) done += 1;
    });
    count.textContent = done + ' of ' + steps.length + ' steps done';
    fill.style.width = (steps.length ? (100 * done / steps.length) : 0) + '%';
  }
  steps.forEach(function (li) {
    li.querySelector('input').addEventListener('change', function (e) { state[li.dataset.id] = e.target.checked; save(); render(); });
  });
  document.getElementById('reset').addEventListener('click', function () { state = {}; save(); render(); });
  render();
})();
