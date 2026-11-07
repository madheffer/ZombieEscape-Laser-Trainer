// A stage's `marks`: what the map has made you, shown as a line of screen text above your health while you carry the
// context it gives you. ze_amdaporkeep's Omega ending: a red laser adds VirusR, a blue one VirusB, and the other
// colour kills you after that, so the HUD says which one you are. Scenario data is untrusted: the text goes in as
// textContent (ui/hud.js) and only a plain hex colour is used.
const HEX = /^#[0-9a-f]{3,8}$/i;

// scenario.marks: [{ context, text, color }]; the first one whose context you carry wins
export function playerMark(scenario, engine) {
  const have = engine?.playerEnt?.contexts;
  if (!have?.size) return null;
  for (const m of scenario?.marks || []) {
    if (!m || typeof m.context !== 'string' || !have.has(m.context.toLowerCase())) continue;
    return { text: String(m.text || ''), color: HEX.test(m.color || '') ? m.color : '' };
  }
  return null;
}
