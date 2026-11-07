// The end card's blocks (ui/overlay.js draws them in this order under the title): the badges (a new record), the
// times strip (this run / your best / the record, each in its own column), the small stat chips, a room's awards
// (who dodged the most, who lasted longest, who went down first) and its player table. Every string is escaped
// here: names come from other players.
import { esc } from '../lib/dom.js';

const TONES = new Set(['good', 'bad', 'gold', 'dim']);
const tone = (t) => (TONES.has(t) ? ` t-${t}` : '');

// badges: [{ text, tone }]
export const badges = (list) => (list?.length
  ? `<div class="ov-badges">${list.map((b) => `<span class="ov-badge${tone(b.tone)}">${esc(b.text)}</span>`).join('')}</div>` : '');

// times: [{ label, value, note?, tone?, hi? }]: one column each, the note under the value (a delta, or who holds it)
export const times = (list) => (list?.length
  ? `<div class="ov-times">${list.map((t) => `<div class="${t.hi ? 'hi' : ''}"><span class="k">${esc(t.label)}</span><span class="v">${esc(t.value)}</span>${t.note ? `<span class="n${tone(t.tone)}">${esc(t.note)}</span>` : ''}</div>`).join('')}</div>` : '');

// stats: [[label, value, highlight?]]: the small chips
export const stats = (list) => (list?.length
  ? `<dl class="ov-stats">${list.map(([k, v, hi]) => `<div class="${hi ? 'hi' : ''}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '');

// awards: [{ label, who, value, tone? }]
export const awards = (list) => (list?.length
  ? `<div class="ov-awards">${list.map((a) => `<div class="${tone(a.tone).trim()}"><span class="k">${esc(a.label)}</span><span class="who">${esc(a.who)}</span><span class="v">${esc(a.value)}</span></div>`).join('')}</div>` : '');

// table: { cols: [{ label, num? }], rows: [{ cells: [{ text, tone?, lead?, tag? }], you?, dead? }] }
// lead: the column's best (gold); tag: a small chip after the text (MVP)
export function table(t) {
  if (!t?.rows?.length) return '';
  const head = t.cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = t.rows.map((r) => `<tr class="${[r.you && 'you', r.dead && 'dead'].filter(Boolean).join(' ')}">${r.cells.map((c, i) =>
    `<td class="${[t.cols[i]?.num && 'num', c.lead && 'lead', tone(c.tone).trim()].filter(Boolean).join(' ')}">${esc(c.text)}${c.tag ? ` <span class="ov-tag">${esc(c.tag)}</span>` : ''}</td>`).join('')}</tr>`).join('');
  return `<div class="ov-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// place: { value: '#4', of: 'of 37', line: 'Better than 89% of players', gap: '1.20 s off #3', pct, tone }: where the
// run lands on the stage's board, with a bar filled to the share of players it beats
export function place(p) {
  if (!p) return '';
  const pct = Number.isFinite(p.pct) ? Math.max(0, Math.min(100, p.pct)) : null;
  return `<div class="ov-place${tone(p.tone)}"><div class="rank"><span class="v">${esc(p.value)}</span><span class="of">${esc(p.of)}</span></div>`
    + `<div class="info"><span class="line">${esc(p.line)}</span>${pct != null ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}`
    + `${p.gap ? `<span class="gap">${esc(p.gap)}</span>` : ''}</div></div>`;
}
