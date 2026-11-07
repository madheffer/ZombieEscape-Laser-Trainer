// A room's running totals, for the scoreboard (Tab in a round: ui/scoreboard.js): each player's lasers / balls dodged,
// rounds won and lost and MVPs since they joined the room, and the teams' round score (CS2's big number by each team:
// humans = rounds the stage was cleared, zombies = rounds it was lost). Kept on the room while it lives, sent in its
// 'room' message (coop-relay.js roomView). Every number is the server's: its copies of the runs counted the dodges
// (coop-check.js), its round decided the winners and the best run (coop-round.js end).
import { emptyTally } from '../src/lib/laser-score.js';

export function roomTally(room) {
  room.tally ||= new Map(); // member id -> { lasers, balls, wins, losses, mvps }
  room.score ||= { humans: 0, zombies: 0 };
  return room.tally;
}

// a finished round (its end verdict, coop-round.js this.result) into the room's totals; a replaced round has none
export function tallyRound(room, round) {
  const res = round.result;
  if (!res) return false;
  const tally = roomTally(room);
  if (res.result === 'win') room.score.humans++; else room.score.zombies++;
  for (const s of res.stats) {
    if (s.cheat) continue; // removed by the anti-cheat: the round doesn't count for them
    const t = tally.get(s.id) || emptyTally();
    t.lasers += s.dl || 0; t.balls += s.db || 0;
    if (res.winners.includes(s.id)) t.wins++; else t.losses++;
    if (res.best.includes(s.id)) t.mvps++;
    tally.set(s.id, t);
  }
  return true;
}

// what the room's members see: their totals, or an empty one before their first round
export const tallyOf = (room, id) => room.tally?.get(id) || emptyTally();
export const forget = (room, id) => room.tally?.delete(id);
