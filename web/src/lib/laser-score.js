// A room's scoreboard numbers (ui/scoreboard.js, server/coop-tally.js). Not CS2's: CS2's score counts kills and
// objectives, and a laser stage has neither. Ours, for everything you did in the room so far:
//   1 point per laser or ball dodged (world/dodges.js, counted on the server's copy of your run)
//   10 per round won (you were alive when the stage was cleared)
//   5 per MVP (the round's best run: server/coop-round.js end)
export const SCORE_DODGE = 1, SCORE_WIN = 10, SCORE_MVP = 5;

// t: { lasers, balls, wins, mvps }
export const laserScore = (t) => (t.lasers + t.balls) * SCORE_DODGE + t.wins * SCORE_WIN + t.mvps * SCORE_MVP;

// an empty tally: what a player who just joined the room has
export const emptyTally = () => ({ lasers: 0, balls: 0, boss: 0, wins: 0, losses: 0, mvps: 0 });
