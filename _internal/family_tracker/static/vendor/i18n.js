/* ═══════════════════════════════════════════════════════════════
   KinElora i18n — Translation module + language picker
   Default language: English (en)
   Languages marked `active:false` are placeholders — provide a full
   translation JSON at static/vendor/i18n/<code>.json and flip
   `active:true` to enable them.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LANGUAGES = {
    en: { label: 'English',   flag: '🇬🇧', dir: 'ltr', active: true },
    ar: { label: 'العربية',   flag: '🇸🇦', dir: 'rtl', active: true },
    fr: { label: 'Français',  flag: '🇫🇷', dir: 'ltr', active: true },
    es: { label: 'Español',   flag: '🇪🇸', dir: 'ltr', active: true },
    de: { label: 'Deutsch',   flag: '🇩🇪', dir: 'ltr', active: true },
    it: { label: 'Italiano',  flag: '🇮🇹', dir: 'ltr', active: true },
    pt: { label: 'Português', flag: '🇵🇹', dir: 'ltr', active: true },
    tr: { label: 'Türkçe',    flag: '🇹🇷', dir: 'ltr', active: true },
    ur: { label: 'اردو',      flag: '🇵🇰', dir: 'rtl', active: true },
    fa: { label: 'فارسی',     flag: '🇮🇷', dir: 'rtl', active: true },
    hi: { label: 'हिन्दी',    flag: '🇮🇳', dir: 'ltr', active: true },
    zh: { label: '中文',      flag: '🇨🇳', dir: 'ltr', active: true },
    ru: { label: 'Русский',   flag: '🇷🇺', dir: 'ltr', active: true },
    id: { label: 'Indonesia', flag: '🇮🇩', dir: 'ltr', active: true }
  };

  var DEFAULT_LANG = 'en';
  var DICT = {};
  var CURRENT = DEFAULT_LANG;
  var FALLBACK_EN = null;
  var READY = false;
  var pending = [];

  function getLang() {
    try {
      var saved = localStorage.getItem('kielora_lang');
      if (saved && LANGUAGES[saved] && LANGUAGES[saved].active) return saved;
    } catch (e) {}
    return DEFAULT_LANG;
  }

  function injectStyle() {
    var id = 'ki-lang-picker-style';
    if (document.getElementById(id)) return;
    var st = document.createElement('style');
    st.id = id;
    st.textContent = [
      '.lang-picker{position:relative;display:inline-block}',
      '.lp-trigger{display:flex;align-items:center;gap:6px;background:#1a1d2e;border:1px solid #272b42;color:#f5c518;font-family:\'Tajawal\',sans-serif;font-size:12px;font-weight:800;padding:6px 10px;border-radius:8px;cursor:pointer;min-width:0;white-space:nowrap;transition:background .15s,color .15s}',
      '.lp-trigger:hover{background:#f5c518;color:#000}',
      '.lp-trigger .lp-flag{font-size:15px;line-height:1}',
      '.lp-trigger .lp-caret{font-size:9px;opacity:.85;margin-inline-start:2px}',
      '.lp-panel{position:absolute;top:calc(100% + 6px);left:0;right:auto;width:250px;background:#141625;border:1px solid #272b42;border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.6);overflow:hidden;z-index:400;text-align:start}',
      '.lp-header .lp-panel,.lp-right .lp-panel{left:auto;right:0}',
      '.lp-search{padding:8px;border-bottom:1px solid #1f2340;background:#10121f}',
      '.lp-search input{width:100%;background:#1a1d2e;border:1px solid #272b42;border-radius:8px;color:#e8eaf6;font-family:\'Tajawal\',sans-serif;font-size:12px;padding:6px 10px;outline:none;box-sizing:border-box}',
      '.lp-search input:focus{border-color:#f5c518}',
      '.lp-list{max-height:290px;overflow-y:auto}',
      '.lp-item{display:flex;align-items:center;gap:10px;width:100%;background:none;border:none;color:#cfd4e8;font-family:\'Tajawal\',sans-serif;font-size:13px;padding:9px 12px;cursor:pointer;text-align:start;transition:background .12s;box-sizing:border-box}',
      '.lp-item:hover{background:#1f2340}',
      '.lp-item .lp-flag{font-size:17px;line-height:1}',
      '.lp-item .lp-name{font-weight:600;flex:1}',
      '.lp-item .lp-check{color:#f5c518;font-weight:900}',
      '.lp-item.lp-dis{opacity:.5;cursor:not-allowed}',
      '.lp-item.lp-dis:hover{background:none}',
      '.lp-item.sel{background:rgba(245,197,24,.08);color:#f5c518}',
      '.lp-badge{font-size:9px;background:rgba(245,197,24,.14);color:#f5c518;border-radius:5px;padding:1px 6px;font-weight:800;white-space:nowrap}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function loadJSON(url, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function () {
      if (xhr.status === 200) {
        try { cb(null, JSON.parse(xhr.responseText)); }
        catch (e) { cb(e, null); }
      } else {
        cb(new Error('HTTP ' + xhr.status), null);
      }
    };
    xhr.onerror = function () { cb(new Error('network'), null); };
    xhr.send();
  }

  function ensureReady(cb) {
    if (READY) { cb(); return; }
    pending.push(cb);
  }

  function init() {
    CURRENT = getLang();
    injectStyle();
    var base = new URL(i18nURL(), window.location.href);
    var needsEnglishFallback = CURRENT !== 'en';
    loadJSON(base.href.replace('/en.json', '/' + CURRENT + '.json'), function (err, dict) {
      if (err || !dict) dict = {};
      DICT = dict;
      if (needsEnglishFallback) {
        loadJSON(base.href, function (err2, enDict) {
          FALLBACK_EN = enDict || {};
          READY = true;
          updateSwitcher();
          renderPickers();
          applyToDOM();
          notifyPending();
        });
      } else {
        FALLBACK_EN = {};
        READY = true;
        updateSwitcher();
        renderPickers();
        applyToDOM();
        notifyPending();
      }
    });
  }

  function i18nURL() {
    // Resolve relative to the document regardless of base path
    for (var i = document.scripts.length - 1; i >= 0; i--) {
      var s = document.scripts[i];
      if (s.src && /i18n\.js/i.test(s.src)) {
        return s.src.replace(/i18n\.js$/, 'i18n/en.json');
      }
    }
    return 'static/vendor/i18n/en.json';
  }

  function notifyPending() {
    var callbacks = pending;
    pending = [];
    callbacks.forEach(function (cb) { try { cb(); } catch (e) {} });
  }

  function lookup(key) {
    if (DICT && DICT.hasOwnProperty(key)) return DICT[key];
    if (CURRENT === 'en') return key;
    if (FALLBACK_EN && FALLBACK_EN.hasOwnProperty(key)) return FALLBACK_EN[key];
    return key;
  }

  function t(key, params) {
    var str = lookup(key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.split('{' + k + '}').join(params[k]);
      });
    }
    return str;
  }

  function translateAll(root) {
    var r = root || document;
    var els = r.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    }
    var phs = r.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < phs.length; j++) {
      phs[j].setAttribute('placeholder', t(phs[j].getAttribute('data-i18n-ph')));
    }
    var titles = r.querySelectorAll('[data-i18n-title]');
    for (var k = 0; k < titles.length; k++) {
      titles[k].setAttribute('title', t(titles[k].getAttribute('data-i18n-title')));
    }
  }

  function applyToDOM() {
    var html = document.documentElement;
    var langInfo = LANGUAGES[CURRENT] || LANGUAGES[DEFAULT_LANG];
    html.setAttribute('lang', CURRENT);
    html.setAttribute('dir', langInfo.dir);
    translateAll(document);
    updateSwitcher();
    document.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang: CURRENT } }));
  }

  function switchLang(lang) {
    if (!LANGUAGES[lang] || !LANGUAGES[lang].active) return;
    if (lang === CURRENT && READY) return;
    CURRENT = lang;
    try { localStorage.setItem('kielora_lang', lang); } catch (e) {}
    try {
      document.dispatchEvent(new CustomEvent('i18n:langchange', { detail: { lang: lang } }));
    } catch (e) {}
    if (!READY) { init(); return; }
    loadJSON(i18nURL().replace('/en.json', '/' + lang + '.json'), function (err, dict) {
      DICT = dict || {};
      closeAllPickers();
      if (lang !== 'en') {
        loadJSON(i18nURL(), function (e2, en) { FALLBACK_EN = en || {}; READY = true; applyToDOM(); });
      } else {
        FALLBACK_EN = {};
        READY = true;
        applyToDOM();
      }
    });
  }

  /* ── Language picker ───────────────────────────────────────── */
  function renderPickers() {
    var els = document.querySelectorAll('[data-lang-picker]');
    for (var i = 0; i < els.length; i++) buildLangPicker(els[i]);
  }

  function buildLangPicker(host) {
    if (host._kiBuilt) { updateSwitcher(); return; }
    host._kiBuilt = true;
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'lp-trigger';
    var panel = document.createElement('div');
    panel.className = 'lp-panel';
    panel.style.display = 'none';

    var searchBox = document.createElement('div');
    searchBox.className = 'lp-search';
    var input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = t('lang.search');
    input.setAttribute('data-lp-search', '');
    searchBox.appendChild(input);

    var list = document.createElement('div');
    list.className = 'lp-list';
    list.setAttribute('data-lp-list', '');

    panel.appendChild(searchBox);
    panel.appendChild(list);
    host.appendChild(trigger);
    host.appendChild(panel);

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePicker(host);
    });
    input.addEventListener('input', function () { renderPickerList(host); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeAllPickers(); }
    });
    list.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('[data-lp-code]') : null;
      if (!item) return;
      var code = item.getAttribute('data-lp-code');
      var info = LANGUAGES[code];
      if (!info || !info.active) return;
      switchLang(code);
      closeAllPickers();
    });

    renderPickerList(host);
    updateSwitcher();
  }

  function togglePicker(host) {
    var panel = host.querySelector('.lp-panel');
    if (!panel) return;
    var isOpen = panel.style.display !== 'none';
    closeAllPickers();
    if (!isOpen) {
      var inp = host.querySelector('[data-lp-search]');
      if (inp) inp.value = '';
      renderPickerList(host);
      panel.style.display = 'block';
      if (inp) inp.focus();
    }
  }

  function closeAllPickers() {
    var panels = document.querySelectorAll('.lp-panel');
    for (var i = 0; i < panels.length; i++) panels[i].style.display = 'none';
  }

  function renderPickerList(host) {
    var list = host.querySelector('[data-lp-list]');
    if (!list) return;
    var input = host.querySelector('[data-lp-search]');
    var q = input ? input.value.trim().toLowerCase() : '';
    var rows = [];
    Object.keys(LANGUAGES).forEach(function (code) {
      var info = LANGUAGES[code];
      var hay = (info.label + ' ' + (info.active ? code : '')).toLowerCase();
      if (q && hay.indexOf(q) === -1) return;
      var isSel = code === CURRENT;
      var selCls = isSel ? ' sel' : '';
      var disCls = info.active ? '' : ' lp-dis';
      var state = '';
      if (isSel) state = '<span class="lp-check">✓</span>';
      else if (!info.active) state = '<span class="lp-badge">' + t('lang.soon') + '</span>';
      rows.push(
        '<button type="button" class="lp-item' + selCls + disCls + '" data-lp-code="' + code + '">' +
          '<span class="lp-flag">' + info.flag + '</span>' +
          '<span class="lp-name">' + info.label + '</span>' +
          state +
        '</button>'
      );
    });
    list.innerHTML = rows.join('') || '<div style="padding:14px;color:#9aa0bd;font-size:12px;text-align:center">—</div>';
  }

  function updateSwitcher() {
    var hosts = document.querySelectorAll('[data-lang-picker]');
    for (var i = 0; i < hosts.length; i++) {
      var trigger = hosts[i].querySelector('.lp-trigger');
      if (!trigger) continue;
      var info = LANGUAGES[CURRENT];
      trigger.innerHTML = '<span class="lp-flag">' + info.flag + '</span><span>' + info.label + '</span><span class="lp-caret">▼</span>';
      var ph = hosts[i].querySelector('[data-lp-search]');
      if (ph) ph.placeholder = t('lang.search');
      renderPickerList(hosts[i]);
    }
  }

  function current() { return CURRENT; }
  function isRTL() { var info = LANGUAGES[CURRENT]; return !!info && info.dir === 'rtl'; }

  // Close pickers when clicking anywhere else
  document.addEventListener('click', function (e) {
    var p = e.target.closest ? e.target.closest('.lang-picker') : null;
    if (!p) closeAllPickers();
  });

  window.i18n = {
    t: t,
    init: init,
    ready: ensureReady,
    translateAll: translateAll,
    switchLang: switchLang,
    current: current,
    isRTL: isRTL,
    languages: LANGUAGES
  };
  window.t = t;

  // Load on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // When i18n becomes ready, re-translate any dynamic content that may have been rendered before translations were loaded
  document.addEventListener('i18n:ready', () => {
    // Force re-render of current view to apply translations
    if (typeof renderCurrentView === 'function') {
      renderCurrentView();
    }
  });

  // When language changes, re-render current view
  document.addEventListener('i18n:langchange', () => {
    if (typeof renderCurrentView === 'function') {
      renderCurrentView();
    }
  });
})();