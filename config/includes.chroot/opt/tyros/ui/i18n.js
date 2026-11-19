/* TyrOS arayüz dili.
   Arayüz Türkçe yazılmıştır. Sistem dili Türkçe değilse (ör. canlı USB oturumu İngilizce açılır,
   diske kurulumda başka dil seçilir) ekrana gelen her yazı çeviri sözlüğünden anında çevrilir.
   Yeni bir dil eklemek için i18n-<dil>.js dosyası yeterli; kodun geri kalanı değişmez. */
'use strict';
(function () {
  let info = null;
  try {
    const x = new XMLHttpRequest();
    x.open('GET', '/api/lang', false);          // açılışta bir kez, yerel ve çok hızlı
    x.setRequestHeader('X-TyrOS', '1');
    x.send();
    if (x.status === 200) info = JSON.parse(x.responseText);
  } catch { /* köprü yoksa tarayıcının diline bak */ }
  if (!info) info = { ui: /^tr\b/i.test(navigator.language || '') ? 'tr' : 'en', system: navigator.language || '', pref: 'auto' };
  const lang = info.ui || 'tr';
  window.UI_LANG = lang;
  window.UI_LOCALE = lang === 'tr' ? 'tr-TR' : 'en-US';
  window.UI_LANG_INFO = info;
  document.documentElement.lang = lang;

  const dict = (window.TY_I18N || {})[lang];
  window.T = s => s;
  if (lang === 'tr' || !dict) return;          // Türkçe: hiçbir şey yapma, ek yük yok

  const exact = new Map(), ctx = new Map(), pats = [];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [k, v] of Object.entries(dict)) {
    if (k.includes('@')) { ctx.set(k, v); continue; }
    if (!/\{\d\}/.test(k)) { exact.set(k, v); continue; }
    const order = [...k.matchAll(/\{(\d)\}/g)].map(m => +m[1]);
    const re = new RegExp('^' + esc(k).replace(/\\\{(\d)\\\}/g, '([\\s\\S]*?)') + '$');
    pats.push({ re, v, order, lit: k.replace(/\{\d\}/g, '').length });
  }
  pats.sort((a, b) => b.lit - a.lit);           // en özel kalıp önce

  const one = s => {
    if (exact.has(s)) return exact.get(s);
    for (const p of pats) {
      const m = p.re.exec(s);
      if (m) return p.v.replace(/\{(\d)\}/g, (_, i) => { const g = m[p.order.indexOf(+i) + 1]; return g == null ? '' : (exact.get(g.trim()) ? g.replace(g.trim(), exact.get(g.trim())) : g); });
    }
    return null;
  };
  const LETTER = /[A-Za-zÇĞİÖŞÜçğıöşü]/;
  function tr(s, el) {
    if (!s || !LETTER.test(s)) return null;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const core = m[2];
    const c = el && el.closest && el.closest('[data-i18n-ctx]');
    if (c && ctx.has(core + '@' + c.dataset.i18nCtx)) return m[1] + ctx.get(core + '@' + c.dataset.i18nCtx) + m[3];
    let r = one(core);
    if (r === null && core.includes(' · ')) {
      // "Bağlı · Şifreli · sinyal %90" gibi birleşik yazılar: parça parça çevir
      let changed = false;
      const parts = core.split(' · ').map(p => { const t = one(p.trim()); if (t !== null) { changed = true; return p.replace(p.trim(), t); } return p; });
      if (changed) r = parts.join(' · ');
    }
    return r === null ? null : m[1] + r + m[3];
  }
  window.T = s => tr(s) ?? s;

  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE']);
  const notr = el => !el || (el.closest && el.closest('[data-notr]'));
  const blocked = el => !el || SKIP.has(el.tagName) || notr(el);
  function doText(n) {
    const p = n.parentElement;
    if (blocked(p)) return;
    const r = tr(n.nodeValue, p);
    if (r !== null && r !== n.nodeValue) n.nodeValue = r;
  }
  function doAttr(el, a) {
    const v = el.getAttribute(a);
    if (!v) return;
    const r = tr(v, el);
    if (r !== null && r !== v) el.setAttribute(a, r);
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || notr(root)) return;
    for (const a of ATTRS) doAttr(root, a);
    if (SKIP.has(root.tagName)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeType === 1 && n.hasAttribute('data-notr')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else for (const a of ATTRS) doAttr(n, a); }
  }
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes' && !notr(m.target)) doAttr(m.target, m.attributeName);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  if (document.body) walk(document.body);
})();
