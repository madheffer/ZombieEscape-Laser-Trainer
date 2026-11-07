// The console window (CS2's: ` opens it). Draws app/console/output.js's lines, takes a line, and shows the completion
// list as you type. All text goes in with textContent. Knows nothing about what the commands do:
//
//   new ConsoleWindow({ submit(line), complete(line) -> [{ line, name, detail }], onClose })
//   .open() / .close() / .toggle() / .isOpen / .contains(node)
//
// Keys in the entry: Enter runs it; Tab / Shift+Tab step through the suggestions (filling the entry, as CS2's does),
// Up / Down too while they show, else they walk the history; Esc or ` closes.
// Where it sits, its size and the last 50 lines you ran are kept in this browser (lasers.console).
import './console.css';
import { lines, onLines, onClear } from '../app/console/output.js';
import { loadJson, saveJson } from '../lib/storage.js';
import { clamp } from '../lib/math.js';

const KEY = 'lasers.console';
const HISTORY = 50;
const MAX_NODES = 2000; // output.js keeps as many lines
const MIN_W = 360, MIN_H = 200;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class ConsoleWindow {
  constructor({ submit, complete, onClose = () => {} }) {
    this.submit = submit;
    this.completeFn = complete;
    this.onClose = onClose;
    this.root = el('div', 'con');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Console');
    const bar = el('div', 'con-bar');
    const x = el('button', 'con-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close the console');
    bar.append(el('div', 'con-title', 'Console'), x);
    this.log = el('div', 'con-log');
    this.log.setAttribute('role', 'log');
    const entry = el('div', 'con-entry');
    this.input = el('input', 'con-input');
    Object.assign(this.input, { type: 'text', spellcheck: false, autocomplete: 'off', maxLength: 512 });
    this.input.setAttribute('aria-label', 'Console command');
    const go = el('button', 'con-submit', 'Submit');
    go.type = 'button';
    this.list = el('ul', 'con-suggest');
    this.list.hidden = true;
    this.list.setAttribute('role', 'listbox');
    entry.append(this.input, go, this.list);
    const grip = el('div', 'con-grip');
    this.root.append(bar, this.log, entry, grip);
    document.body.append(this.root);

    const saved = loadJson(KEY);
    this.history = Array.isArray(saved.history) ? saved.history.filter((h) => typeof h === 'string' && h.length <= 512).slice(-HISTORY) : [];
    this.rect = ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(saved.rect?.[k])) ? { ...saved.rect } : null;
    this.hIndex = -1; // walking the history: its index, -1 = not
    this.typed = ''; // what the suggestions are for (stepping through them changes the entry, not this)
    this.suggestions = [];
    this.sel = -1;

    for (const l of lines) this.add(l);
    onLines((added) => { if (!this.root.hidden) this.append(added); else this.pending = true; });
    onClear(() => { this.log.textContent = ''; });

    x.addEventListener('click', () => this.close());
    go.addEventListener('click', () => { this.run(); this.input.focus(); });
    this.input.addEventListener('input', () => this.suggest(this.input.value));
    this.input.addEventListener('keydown', (ev) => this.key(ev));
    // ` only opens / closes the console (app/console/index.js): it never lands in the entry, however it arrives
    // (a dead key's composition, a layout that types it from another key)
    this.input.addEventListener('beforeinput', (ev) => { if (ev.data?.includes('`')) ev.preventDefault(); });
    this.list.addEventListener('mousedown', (ev) => {
      const li = ev.target.closest('li');
      if (!li) return;
      ev.preventDefault(); // keep the entry focused
      this.pick(Number(li.dataset.i));
    });
    this.drag(bar, (dx, dy, r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
    this.drag(grip, (dx, dy, r) => ({ ...r, w: r.w + dx, h: r.h + dy }));
    addEventListener('resize', () => { if (this.rect) this.place(this.rect); });
  }

  get isOpen() { return !this.root.hidden; }
  contains(node) { return this.root.contains(node); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  open() {
    if (this.isOpen) return;
    this.root.hidden = false;
    if (this.rect) this.place(this.rect);
    if (this.pending) { this.pending = false; this.log.textContent = ''; for (const l of lines) this.add(l); }
    this.log.scrollTop = this.log.scrollHeight;
    this.input.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.hideList();
    this.input.blur();
    this.onClose();
  }

  // ---- output
  add({ text, tone }) {
    const d = el('div', tone || null, text || ' ');
    this.log.append(d);
  }

  append(added) {
    const atEnd = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    for (const l of added) this.add(l);
    while (this.log.childElementCount > MAX_NODES) this.log.firstElementChild.remove();
    if (atEnd) this.log.scrollTop = this.log.scrollHeight;
  }

  // ---- the entry
  run() {
    const line = this.input.value.trim();
    this.input.value = '';
    this.typed = '';
    this.hIndex = -1;
    this.hideList();
    if (!line) return;
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY);
    this.save();
    this.log.scrollTop = this.log.scrollHeight;
    this.submit(line);
  }

  key(ev) {
    ev.stopPropagation(); // the game's keys (app/input.js, the end card's) never see what is typed here
    const listed = !this.list.hidden && this.suggestions.length > 0;
    switch (ev.key) {
      case 'Enter': ev.preventDefault(); this.run(); return;
      case 'Escape': ev.preventDefault(); this.close(); return;
      case 'Tab':
        ev.preventDefault();
        // nothing listed, or the one name listed already in the entry: on to what can follow it (a map name, 0 / 1)
        if (!this.suggestions.length || (this.suggestions.length === 1 && this.input.value === this.suggestions[0].line)) this.suggest(this.input.value);
        if (this.suggestions.length) this.step(ev.shiftKey ? -1 : 1);
        return;
      case 'ArrowDown': case 'ArrowUp': {
        ev.preventDefault();
        const d = ev.key === 'ArrowDown' ? 1 : -1;
        if (listed) this.step(d); else this.walkHistory(-d);
        return;
      }
    }
    if (ev.code === 'Backquote') { ev.preventDefault(); if (!ev.repeat) this.close(); }
  }

  walkHistory(d) {
    if (!this.history.length) return;
    // d -1 = older (Up), +1 = newer (Down)
    let i = this.hIndex < 0 ? this.history.length : this.hIndex;
    i = clamp(i + d, 0, this.history.length);
    this.hIndex = i >= this.history.length ? -1 : i;
    this.input.value = this.hIndex < 0 ? '' : this.history[this.hIndex];
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  suggest(text) {
    this.typed = text;
    this.hIndex = -1;
    this.suggestions = this.completeFn(text);
    this.sel = -1;
    this.drawList();
  }

  step(d) {
    const n = this.suggestions.length;
    this.sel = this.sel < 0 ? (d > 0 ? 0 : n - 1) : (this.sel + d + n) % n;
    this.fill(this.suggestions[this.sel].line);
    this.drawList();
  }

  pick(i) {
    const s = this.suggestions[i];
    if (!s) return;
    this.fill(s.line);
    this.suggest(s.line); // on to its arguments
    this.input.focus();
  }

  fill(text) {
    this.input.value = text;
    this.input.setSelectionRange(text.length, text.length);
  }

  drawList() {
    const list = this.list;
    list.textContent = '';
    if (!this.suggestions.length) { this.hideList(); return; }
    this.suggestions.forEach((s, i) => {
      const li = el('li', i === this.sel ? 'sel' : null);
      li.dataset.i = String(i);
      li.setAttribute('role', 'option');
      li.append(el('b', null, s.name));
      if (s.detail) li.append(el('span', null, s.detail));
      list.append(li);
    });
    list.hidden = false;
    // below the window when there is room for it on screen, else over the log
    const r = this.root.getBoundingClientRect();
    list.classList.toggle('up', r.bottom + 200 > innerHeight);
    list.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  hideList() { this.list.hidden = true; this.suggestions = []; this.sel = -1; }

  // ---- where it sits
  drag(handle, move) {
    handle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('button')) return;
      ev.preventDefault();
      const b = this.root.getBoundingClientRect();
      const start = { x: b.left, y: b.top, w: b.width, h: b.height };
      const x0 = ev.clientX, y0 = ev.clientY;
      handle.setPointerCapture(ev.pointerId);
      const onMove = (e) => this.place(move(e.clientX - x0, e.clientY - y0, start));
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        this.save();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  // kept on screen: at least its bar can always be grabbed
  place(r) {
    const w = clamp(r.w, MIN_W, Math.max(MIN_W, innerWidth));
    const h = clamp(r.h, MIN_H, Math.max(MIN_H, innerHeight));
    const x = clamp(r.x, Math.min(0, innerWidth - w), Math.max(0, innerWidth - w));
    const y = clamp(r.y, 0, Math.max(0, innerHeight - 32));
    this.rect = { x, y, w, h };
    Object.assign(this.root.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  }

  save() { saveJson(KEY, { history: this.history, rect: this.rect }); }
}
