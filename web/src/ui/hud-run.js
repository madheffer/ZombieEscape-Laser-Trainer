// The run panel top-left of the HUD: who you're playing with (solo / co-op), the map, the stage's level and name
// (a stage's `group`, its parent's for a single attack: many maps have an "Ending (full)"), the clock, and your best
// for this stage against the clock.
//   normal  : best = fastest clear. The bar fills toward it; once the clock passes it the panel turns red (over PB).
//   endless : best = longest survived. The bar fills toward it; passing it is a new best (gold, one pulse).
// Pure DOM, fed by ui/hud.js update(v.run); the data comes from app/run-panel.js runPanelData.
import './hud-run.css';
import { replayClass } from '../lib/dom.js';
import { clamp01 } from '../lib/math.js';
import { formatTime } from '../lib/format.js';

// "-6.67" / "+1:02.10": a gap to the best, signed
function delta(s) {
  const a = Math.abs(s);
  return (s < 0 ? '−' : '+') + (a < 60 ? a.toFixed(2) : formatTime(a));
}

export class RunPanel {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="hr-top"><span class="hr-party"></span><span class="hr-map"></span></div>
      <div class="hr-stage"><span class="hr-level"></span><span class="hr-name"></span><span class="hr-tag"></span></div>
      <div class="hr-timer"></div>
      <div class="hr-best"><div class="hr-bar"><i></i></div><span class="hr-pb"></span><span class="hr-delta"></span></div>
      <div class="hr-sub"></div>`;
    const q = (s) => root.querySelector(s);
    this.el = { party: q('.hr-party'), map: q('.hr-map'), level: q('.hr-level'), name: q('.hr-name'), tag: q('.hr-tag'),
      timer: q('.hr-timer'), best: q('.hr-best'), bar: q('.hr-bar i'), pb: q('.hr-pb'), delta: q('.hr-delta'), sub: q('.hr-sub') };
    this.last = {};
  }

  // r: { party: { label, cls }, map, level, name, tag, timer, waiting, t, best, endless, sub }
  update(r) {
    const e = this.el, last = this.last;
    const set = (k, val) => { val = val || ''; if (last[k] !== val) { last[k] = val; e[k].textContent = val; } };
    set('party', r.party?.label);
    if (last.partyCls !== r.party?.cls) { last.partyCls = r.party?.cls; e.party.className = `hr-party ${r.party?.cls || ''}`; }
    set('map', r.map); set('level', r.level); set('name', r.name); set('tag', r.tag);
    set('timer', r.timer); set('sub', r.sub);
    this.root.classList.toggle('waiting', !!r.waiting);
    this.root.classList.toggle('endless', !!r.endless);

    const has = Number.isFinite(r.best) && r.best > 0;
    e.best.hidden = !has;
    if (!has) { this.setState(''); return; }
    const t = Math.max(0, Number.isFinite(r.t) ? r.t : 0);
    const passed = t > r.best;
    set('pb', `${r.endless ? 'BEST' : 'PB'} ${formatTime(r.best)}`);
    set('delta', t > 0 ? (passed && r.endless ? `NEW BEST ${delta(t - r.best)}` : delta(t - r.best)) : '');
    const w = `${(clamp01(t / r.best) * 100).toFixed(1)}%`;
    if (last.w !== w) { last.w = w; e.bar.style.width = w; }
    this.setState(!passed ? 'ahead' : r.endless ? 'record' : 'over');
  }

  // ahead (on pace / still to go), over (slower than your PB), record (past your endless best): a pulse on the change
  setState(s) {
    if (this.last.state === s) return;
    const was = this.last.state;
    this.last.state = s;
    this.root.dataset.pb = s;
    if (was && (s === 'over' || s === 'record')) replayClass(this.el.best, 'crossed');
  }
}
