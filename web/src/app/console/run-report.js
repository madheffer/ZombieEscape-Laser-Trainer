// The end of a run, printed to the console: how it went, what you dodged (app/dodges.js), what hurt you and how
// much, your shooting. Solo at the end card (session.js finish); in a round when you go down, else at the round's end.
//
//   reportRun(run, { result, scenario, map, time, cause })   result 'win' | 'dead' | 'lose' | 'quit' | 'over'
//   lastReport()                                              the lines of the last one (the `stats` command)
import { print } from './output.js';
import { formatTime, plural } from '../../lib/format.js';

const RULE = '-------------------------';
const HEAD = { win: 'Stage cleared', dead: 'You died', lose: 'Stage failed', quit: 'Run ended', over: 'Run over' };
let last = null;

export const lastReport = () => last;

export function reportRun(run, { result, scenario, map, time, cause = '' }) {
  if (!run || run.consoleReport) return;
  run.consoleReport = true; // once per run (a round's death, then its end)
  const d = run.dodges;
  d?.settle();
  const out = [RULE];
  const where = `${scenario?.name || 'Free roam'}${run.endless ? ' · endless' : ''} (${map})`;
  out.push(`${HEAD[result] || result}: ${where}${cause ? ` · killed by ${cause}` : ''}`);
  out.push(`${run.endless || result !== 'win' ? 'Survived' : 'Time'} ${formatTime(time)} · ${plural(run.hits, 'hit')} taken · ${Math.max(0, Math.round(run.hp))} HP left`);
  if (d) {
    const dodged = Object.values(d.dodged).reduce((a, b) => a + b, 0);
    const parts = [['laser', 'Lasers'], ['ball', 'Balls'], ['hazard', 'Other hazards']]
      .filter(([k]) => d.dodged[k] || d.hit[k]).map(([k, label]) => `${label} dodged ${d.dodged[k]}/${d.dodged[k] + d.hit[k]}`);
    out.push(parts.length ? parts.join(' · ') : 'Nothing came close');
    if (dodged && !run.hits) out.push('Clean: nothing that came at you landed');
    const taken = [...d.taken].sort((a, b) => b[1].damage - a[1].damage);
    for (const [name, t] of taken) out.push(`Damage Taken from "${name}" - ${Math.round(t.damage)} in ${plural(t.hits, 'hit')}`);
  }
  if (run.shots) {
    const acc = Math.round((100 * run.myHits) / run.shots);
    out.push(`Boss: ${plural(run.myHits, 'hit')} of ${plural(run.shots, 'shot')} (${acc}%) · ${Math.round(run.myDamage)} damage`);
  } else if (run.myHits) out.push(`Boss: ${plural(run.myHits, 'hit')} · ${Math.round(run.myDamage)} damage`);
  if (run.jumps) out.push(`${plural(run.jumps, 'jump')} · top speed ${Math.round(d?.topSpeed || 0)} u/s`);
  out.push(RULE);
  last = out;
  const tone = result === 'win' ? 'good' : '';
  for (const [i, line] of out.entries()) print(line, i === 1 ? (tone || 'head') : '');
}
