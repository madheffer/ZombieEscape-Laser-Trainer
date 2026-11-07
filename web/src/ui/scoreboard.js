// CS2's scoreboard (+showscores: shown while Tab is held, so a tap flashes it), for a co-op room. CS2's own layout
// (layout/scoreboard.vxml snippet_scoreboard-classic--no-timeline + snippet_scoreboard-classic__row--casual) and
// style (styles/scoreboard.vcss), from `lasers-bake --panorama`: the meta row ("{gamemode} | {map}", the map clock),
// the column labels, then each team: its round score and name on the left, its players on the right, and the
// spectators under them. A row: status (the elimination X when dead), ping, flair (our badges go here: none yet),
// avatar, name, then our columns, not CS2's: what a laser stage counts (app/scoreboard-data.js, lib/laser-score.js).
//
//   const sb = new Scoreboard(document.body, () => scoreboardData()); sb.show(true / false)
// Names are the server's (untrusted): textContent only.
import './scoreboard.css';

const COLUMNS = [ // [label, row key, cell class]
  ['Lasers', 'lasers'], ['Balls', 'balls'], ['Wins', 'wins'], ['Losses', 'losses'], ['Boss DMG', 'boss', 'damage'], ['Score', 'score', 'score'],
];
// CS2's column shading (scoreboard.vts _InitStatCell / _HighlightSortStatLabel): every second stat cell is dark
// (sb-row__cell--dark, counted from the first stat column), and the column the board is sorted by (casual: score)
// is sortstat, a lighter cell with its text twice as bright. The labels row's cells get the same classes.
const SORT_STAT = 'score';
const shade = (i, cls) => `${i % 2 ? ' sb-row__cell--dark' : ''}${cls === SORT_STAT ? ' sortstat' : ''}`;
const REFRESH_MS = 250;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
// a table's rows, rebuilt only when something in them changed (a rebuild would restart a dying row's red flash)
function fill(table, rows, make) {
  const key = JSON.stringify(rows);
  if (table.dataset.key === key) return;
  table.dataset.key = key;
  table.replaceChildren(...rows.map(make));
}
const cell = (kind, ...kids) => { const c = el('div', `sb-row__cell sb-row__cell--${kind}`); c.append(...kids); return c; };

export class Scoreboard {
  constructor(parent, data) {
    this.data = data;
    this.root = el('div', 'scoreboard');
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    const main = el('div', 'sb-main');
    // meta: mode icon, "{gamemode} | {map}", the map clock; its second row (music kit, server name) stays empty
    const meta = el('div', 'sb-meta');
    const top = el('div', 'meta-row bottom-divider');
    this.title = el('div', 'sb-meta__mode-map');
    this.time = el('div', 'sb-meta__time');
    top.append(el('div', 'sb-meta__mode-image'), this.title, this.time);
    meta.append(top, el('div', 'meta-row'));
    // the labels row, over the rows' columns (the ping column's label is CS2's ping icon)
    const labels = el('div', 'sb-label-container');
    const lrow = el('div', 'sb-row sb-row--labels');
    const inner = el('div', 'highlight-row');
    inner.append(cell('status'), cell('ping', el('div', 'sb-ping-icon')), cell('flair'), cell('avatar'), cell('name'),
      ...COLUMNS.map(([label, , cls], i) => cell(`label${cls ? ` sb-row__cell--${cls}` : ''}${shade(i, cls)}`, el('span', '', label))));
    lrow.append(inner);
    labels.append(lrow, el('div', 'sb-label-spacer'));
    this.teams = { CT: this.team('CT', 'Humans'), TERRORIST: this.team('TERRORIST', 'Zombies') };
    const specTeam = el('div', 'sb-team sb-team--Spectator');
    this.spec = el('div', 'sb-players-table sb-players-table--Spectator');
    specTeam.append(this.spec, el('div', 'sb-team__info'));
    main.append(meta, labels, this.teams.CT.el, el('div', 'sb-timeline'), this.teams.TERRORIST.el, specTeam, el('div', 'sb-footer-panel'));
    this.root.append(main);
    parent.append(this.root);
    this.timer = 0;
  }

  team(name, label) {
    const t = el('div', `sb-team sb-team--${name}`);
    const table = el('div', `sb-players-table sb-players-table--${name}`);
    const info = el('div', `sb-team__info sb-color--${name}`);
    const score = el('div', 'sb-team__info__score');
    const scoreLabel = el('span', '', '0');
    score.append(scoreLabel);
    const number = el('div', 'sb-team__info__number');
    info.append(score, el('div', 'sb-team__info__name', label), number);
    t.append(table, info); // flow-children: left in CS2: the table sits on the right, the info on the left
    return { el: t, table, scoreLabel, number };
  }

  get open() { return !this.root.hidden; }

  // +showscores / -showscores
  show(on) {
    if (on === this.open) return;
    if (on && !this.render()) return; // not in a room
    this.root.hidden = !on;
    clearInterval(this.timer);
    this.timer = on ? setInterval(() => { if (!this.render()) this.show(false); }, REFRESH_MS) : 0;
  }

  render() {
    const d = this.data();
    if (!d) return false;
    this.title.textContent = d.title;
    this.time.textContent = d.time;
    const { CT, TERRORIST } = this.teams;
    CT.scoreLabel.textContent = d.score.humans;
    TERRORIST.scoreLabel.textContent = d.score.zombies;
    CT.number.textContent = `Alive: ${d.alive}/${d.total}`;
    TERRORIST.number.textContent = `Alive: 0/${d.zombies.length}`; // nobody comes back as a zombie here
    const before = this.rowTops();
    fill(CT.table, d.humans, (r) => this.row(r, 'CT'));
    fill(TERRORIST.table, d.zombies, (r) => this.row(r, 'TERRORIST'));
    fill(this.spec, d.spec, (r) => this.specRow(r));
    this.slide(before);
    return true;
  }

  // CS2's .sb-row--transition (position, opacity: 0.25 s ease-in-out): a row that moved (re-sorted, or struck off and
  // over to the zombies) slides from where it was, a new one fades in. Where each row is now, by player id:
  rowTops() { return new Map([...this.root.querySelectorAll('.sb-row[data-id]')].map((e) => [e.dataset.id, e.getBoundingClientRect().top])); }
  slide(before) {
    if (this.root.hidden) return; // opening: no slide
    for (const e of this.root.querySelectorAll('.sb-row[data-id]')) {
      const was = before.get(e.dataset.id);
      const dy = was == null ? 0 : was - e.getBoundingClientRect().top;
      if (was != null && Math.abs(dy) < 0.5) continue;
      e.animate(was == null ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 250, easing: 'ease-in-out' });
    }
  }

  row(r, team) {
    const row = el('div', `sb-row sb-team--${team}`);
    row.dataset.id = r.id;
    row.classList.toggle('sb-row--localplayer', r.you);
    row.classList.toggle('sb-player-status-dead', r.dead);
    const hl = el('div', 'highlight-row');
    // the death flash, picked up where it is if the row is rebuilt mid-flash
    if (r.flash != null) { hl.classList.add('sb-player-pulse-death'); hl.style.animationDelay = `${-r.flash}ms`; }
    const status = cell('status');
    if (r.dead) status.append(el('div', 'sb-status-image sb-team-tint'));
    hl.append(
      status,
      cell('ping', el('span', '', r.ping)),
      cell('flair'), // achievement badges, when they're in
      cell('avatar', el('div', `sb-avatar sb-avatar--${team}`)),
      cell('name', el('span', 'sb-team-tint', r.name)),
      ...COLUMNS.map(([, key, cls], i) => {
        const c = cell(cls || 'stat', el('span', 'sb-team-tint', r[key]));
        c.className += shade(i, cls);
        return c;
      }),
    );
    row.append(hl);
    return row;
  }

  // CS2's spectator row: "SPEC" in the ping column, the avatar and the name, no stats
  specRow(r) {
    const row = el('div', 'sb-row sb-team--Spectator');
    row.dataset.id = r.id;
    const hl = el('div', 'highlight-row');
    hl.append(cell('status'), cell('ping', el('span', 'sb-spec', 'SPEC')), cell('flair'), cell('avatar', el('div', 'sb-avatar sb-avatar--CT')), cell('name', el('span', '', r.name)));
    row.append(hl);
    return row;
  }
}
