// A map's pictures, from its index.json entry (tools/index-maps.mjs): its card picture first (captureCard writes
// maps/<name>/card.webp; `card` is its version), then its loading-screen screenshots (lasers-bake writes
// maps/<name>/shots/N.jpg). The map picker, the home page, the loading screen and the boards all pick from this one
// list, so a map shows the same picture everywhere.
import { isMapName, versioned } from '../lib/paths.js';

const SHOT = /^\d{1,2}\.jpg$/;
const CARD = /^[a-z0-9]{1,16}$/;

// every picture URL of a map, card first; [] for one without any
export function mapPictures(m) {
  if (!isMapName(m?.name)) return [];
  const out = [];
  if (typeof m.card === 'string' && CARD.test(m.card)) out.push(versioned(`maps/${m.name}/card.webp`, [m.version, m.card].filter(Boolean).join('.')));
  for (const f of Array.isArray(m.shots) ? m.shots : []) if (typeof f === 'string' && SHOT.test(f)) out.push(versioned(`maps/${m.name}/shots/${f}`, m.version));
  return out;
}

// a map's main picture URL, or null
export const mapShot = (m) => mapPictures(m)[0] ?? null;
