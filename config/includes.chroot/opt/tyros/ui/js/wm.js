/* TyrOS pencere yöneticisi */
'use strict';

const WM = {
  wins: new Map(),       // id -> pencere nesnesi
  z: 10,
  seq: 0,
  activeId: null,
  listeners: new Set(),

  onChange(fn) { this.listeners.add(fn); },
  emit() { this.listeners.forEach(fn => fn()); },

  area() { return $('#desktop').getBoundingClientRect(); },

  /**
   * Yeni pencere aç.
   * opts: { app, title, width, height, content (Node), single (aynı uygulamadan tek pencere) }
   */
  open(opts) {
    const app = opts.app;
    if (opts.single) {
      const existing = [...this.wins.values()].find(w => w.app.id === app.id);
      if (existing) { this.focus(existing.id); return existing; }
    }
    const id = 'w' + (++this.seq);
    const A = this.area();
    const width = Math.min(opts.width || 760, A.width - 20);
    const height = Math.min(opts.height || 520, A.height - 20);
    const offset = (this.wins.size % 6) * 28;
    const left = Math.max(10, (A.width - width) / 2 - 80 + offset);
    const top = Math.max(10, (A.height - height) / 2 - 40 + offset);

    const btn = (cls, title, svg, fn) => h('button', { class: cls, title, 'aria-label': title, html: svg, onclick: e => { e.stopPropagation(); fn(); } });
    const titleEl = h('div', { class: 'win-title' }, opts.title || app.name);
    const body = h('div', { class: 'win-body' });
    const bar = h('div', { class: 'win-bar' },
      appIcon(app), titleEl,
      h('div', { class: 'win-btns' },
        btn('', 'Simge durumuna küçült', '<svg viewBox="0 0 16 16"><path d="M3 8.5h10"/></svg>', () => this.minimize(id)),
        btn('', 'Ekranı kapla', '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>', () => this.toggleMax(id)),
        btn('x', 'Kapat', '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>', () => this.close(id)),
      ));
    const el = h('div', { class: 'win', role: 'dialog', 'aria-label': opts.title || app.name, style: { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' } },
      bar, body,
      h('div', { class: 'win-resize' }), h('div', { class: 'win-resize-e' }), h('div', { class: 'win-resize-s' }));

    const win = { id, app, el, body, titleEl, onClose: null, state: 'normal' };
    win.setTitle = t => { titleEl.textContent = t; el.setAttribute('aria-label', t); this.emit(); };
    this.wins.set(id, win);
    $('#windows').append(el);

    el.addEventListener('pointerdown', () => this.focus(id), true);
    bar.addEventListener('dblclick', e => { if (!e.target.closest('button')) this.toggleMax(id); });
    this.makeDraggable(win, bar);
    this.makeResizable(win, el.querySelector('.win-resize'), 'se');
    this.makeResizable(win, el.querySelector('.win-resize-e'), 'e');
    this.makeResizable(win, el.querySelector('.win-resize-s'), 's');

    if (opts.content) body.append(opts.content);
    this.focus(id);
    return win;
  },

  focus(id) {
    const w = this.wins.get(id);
    if (!w) return;
    w.el.classList.remove('min', 'inactive');
    w.el.style.zIndex = ++this.z;
    this.activeId = id;
    this.wins.forEach(o => o.id !== id && o.el.classList.add('inactive'));
    this.emit();
  },

  close(id) {
    const w = this.wins.get(id);
    if (!w) return;
    if (w.onClose && w.onClose() === false) return;
    this.wins.delete(id);
    w.el.classList.add('closing');
    setTimeout(() => w.el.remove(), 120);
    if (this.activeId === id) {
      this.activeId = null;
      const top = [...this.wins.values()].filter(o => o.state !== 'min').sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
      if (top) this.focus(top.id);
    }
    this.emit();
  },

  minimize(id) {
    const w = this.wins.get(id);
    if (!w) return;
    w.el.classList.add('min');
    w.prevState = w.state === 'min' ? w.prevState : w.state;
    w.state = 'min';
    if (this.activeId === id) this.activeId = null;
    this.emit();
  },

  restore(id) {
    const w = this.wins.get(id);
    if (!w) return;
    if (w.state === 'min') w.state = w.prevState || 'normal';
    this.focus(id);
  },

  toggleMax(id) {
    const w = this.wins.get(id);
    if (!w) return;
    w.el.classList.toggle('max');
    w.state = w.el.classList.contains('max') ? 'max' : 'normal';
    this.focus(id);
  },

  /** Görev çubuğu tıklaması: aktifse küçült, değilse öne getir */
  taskClick(id) {
    const w = this.wins.get(id);
    if (!w) return;
    if (this.activeId === id && w.state !== 'min') this.minimize(id);
    else this.restore(id);
  },

  shield(on) {
    $$('.shield').forEach(s => s.remove());
    if (on) this.wins.forEach(w => w.body.append(h('div', { class: 'shield' })));
  },

  makeDraggable(win, handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const el = win.el;
      const A = this.area();
      let startX = e.clientX, startY = e.clientY;
      let ox = el.offsetLeft, oy = el.offsetTop;
      let snap = null;
      let hint = null;
      handle.setPointerCapture(e.pointerId);
      this.shield(true);

      const move = ev => {
        // Ekranı kaplamış pencereyi sürüklemek onu eski boyutuna döndürür
        if (el.classList.contains('max')) {
          const ratio = (ev.clientX - A.left) / A.width;
          el.classList.remove('max'); win.state = 'normal';
          ox = ev.clientX - A.left - el.offsetWidth * ratio; oy = 0;
          startX = ev.clientX; startY = ev.clientY;
        }
        const x = ox + ev.clientX - startX;
        const y = Math.max(0, Math.min(A.height - 40, oy + ev.clientY - startY));
        el.style.left = x + 'px';
        el.style.top = y + 'px';

        const px = ev.clientX - A.left, py = ev.clientY - A.top;
        const next = py < 4 ? 'max' : px < 6 ? 'left' : px > A.width - 6 ? 'right' : null;
        if (next !== snap) {
          snap = next;
          hint?.remove(); hint = null;
          if (snap) {
            const r = snap === 'max' ? [0, 0, A.width, A.height] : snap === 'left' ? [0, 0, A.width / 2, A.height] : [A.width / 2, 0, A.width / 2, A.height];
            hint = h('div', { id: 'snapHint', style: { left: r[0] + 6 + 'px', top: r[1] + 6 + 'px', width: r[2] - 12 + 'px', height: r[3] - 12 + 'px' } });
            $('#windows').append(hint);
          }
        }
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this.shield(false);
        hint?.remove();
        if (snap === 'max') { el.classList.add('max'); win.state = 'max'; }
        else if (snap) {
          el.classList.add('snapping');
          Object.assign(el.style, { left: (snap === 'left' ? 0 : A.width / 2) + 'px', top: '0px', width: A.width / 2 + 'px', height: A.height + 'px' });
          setTimeout(() => el.classList.remove('snapping'), 160);
        }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  },

  makeResizable(win, handle, dir) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const el = win.el;
      const sx = e.clientX, sy = e.clientY, sw = el.offsetWidth, sh = el.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      this.shield(true);
      const move = ev => {
        if (dir !== 's') el.style.width = Math.max(320, sw + ev.clientX - sx) + 'px';
        if (dir !== 'e') el.style.height = Math.max(200, sh + ev.clientY - sy) + 'px';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        this.shield(false);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  },
};
