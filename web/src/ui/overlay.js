// End-of-run cards: "You died" and "Stage cleared" (and the end of an endless run, and a room's round). The game is
// paused behind them. Buttons are passed in, so the card knows nothing about game state.
import './overlay.css';
import { esc } from '../lib/dom.js';
import * as part from './overlay-parts.js';

// formatTime lives in lib/format.js; re-exported for ui/menu.js, which imports it from here
export { formatTime } from '../lib/format.js';

export class Overlay {
  constructor(root) {
    this.root = root;
    this.onKey = null;
    root.className = 'overlay hidden';
    document.addEventListener('keydown', (ev) => {
      if (this.root.classList.contains('hidden') || !this.onKey) return;
      this.onKey(ev);
    });
  }

  get open() { return !this.root.classList.contains('hidden'); }

  // card: { kind: 'dead'|'win'|'endless', kicker, title, subtitle, record?: string (one gold badge), badges?, times?, place?,
  //         stats?: [[label, value, highlight?]], awards?, table?, note?: string, buttons: [{ label, key?, primary?, onClick }] }
  // (the blocks' shapes: ui/overlay-parts.js)
  show(card) {
    const r = this.root;
    r.className = `overlay ${card.kind}`;
    const badges = [...(card.record ? [{ text: card.record, tone: 'gold' }] : []), ...(card.badges || [])];
    r.innerHTML = `
      <div class="ov-card${card.table ? ' wide' : ''}">
        <div class="ov-kicker">${esc(card.kicker || '')}</div>
        <h2>${esc(card.title)}</h2>
        ${card.subtitle ? `<div class="ov-sub">${esc(card.subtitle)}</div>` : ''}
        ${part.badges(badges)}
        ${part.times(card.times)}
        ${part.place(card.place)}
        ${part.stats(card.stats)}
        ${part.awards(card.awards)}
        ${part.table(card.table)}
        ${card.note ? `<div class="ov-note">${esc(card.note)}</div>` : ''}
        <div class="ov-buttons">${card.buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? 'primary' : 'ghost'}">${esc(b.label)}${b.key ? ` <kbd>${esc(b.key)}</kbd>` : ''}</button>`).join('')}</div>
      </div>`;
    r.querySelectorAll('button').forEach((el) => el.addEventListener('click', () => card.buttons[+el.dataset.i].onClick()));
    this.onKey = (ev) => {
      const b = card.buttons.find((x) => x.key && (x.key === ev.key || x.key.toLowerCase() === ev.key.toLowerCase() || (x.key === 'Enter' && ev.code === 'Enter')));
      if (b) { ev.preventDefault(); b.onClick(); }
    };
  }

  hide() {
    this.root.className = 'overlay hidden';
    this.root.innerHTML = '';
    this.onKey = null;
  }
}
