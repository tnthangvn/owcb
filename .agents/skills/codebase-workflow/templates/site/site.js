(function () {
  var root = document.documentElement;
  var KEY = 'cw-lang';
  var available = (root.getAttribute('data-langs') || 'vi').split(',');

  function setLang(lang) {
    if (available.indexOf(lang) < 0) lang = available[0];
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang);
    document.querySelectorAll('[data-set-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang));
      b.hidden = available.indexOf(b.getAttribute('data-set-lang')) < 0;
    });
    // Each page link carries one href per language; fall back to any file that exists.
    document.querySelectorAll('a[data-page]').forEach(function (a) {
      var href = a.getAttribute('data-href-' + lang);
      if (!href) available.some(function (l) { return (href = a.getAttribute('data-href-' + l)); });
      if (href) a.setAttribute('href', href);
    });
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }

  // ?lang=xx (from a page breadcrumb) wins over the remembered choice.
  var saved = null;
  var m = /[?&]lang=([a-zA-Z-]+)/.exec(location.search);
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  setLang((m && m[1]) || saved || root.getAttribute('data-lang') || available[0]);
  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang')); });
  });

  var search = document.querySelector('.search');
  if (search) search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase();
    var shown = 0;
    document.querySelectorAll('[data-search]').forEach(function (el) {
      var hit = !q || el.getAttribute('data-search').indexOf(q) >= 0;
      el.classList.toggle('hidden', !hit);
      if (hit && el.classList.contains('card')) shown++;
    });
    document.querySelectorAll('section.group, .nav-group').forEach(function (g) {
      g.classList.toggle('hidden', !g.querySelector('[data-search]:not(.hidden)'));
    });
    var empty = document.querySelector('.empty');
    if (empty) empty.style.display = shown ? 'none' : 'block';
  });
})();
