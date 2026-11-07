// env_tonemap_controller (Source 1's CEnvTonemapController): a CS:GO map's limits on the HDR auto-exposure (and its
// bloom), set by I/O. Visual only: world/exposure-source1.js reads tonemapSettings() every frame.
// Truth sources:
//   CS:GO server.dll's datamap (strings beside "CEnvTonemapController"): the networked m_flCustomAutoExposureMin / Max
//     with m_bUseCustomAutoExposureMin / Max, m_bUseCustomBloomScale, m_flCustomBloomScale(Minimum), m_flTonemapRate,
//     m_flTonemapPercentTarget, m_flTonemapPercentBrightPixels, m_flTonemapMinAvgLum, m_flBloomExponent,
//     m_flBloomSaturation; inputs SetAutoExposureMin / Max, UseDefaultAutoExposure, SetBloomScale, SetBloomScaleRange
//     ("<max bloom> <min bloom>"), UseDefaultBloomScale, SetTonemapRate, SetTonemapPercentTarget,
//     SetTonemapPercentBrightPixels, SetTonemapMinAvgLum, SetBloomExponent, SetBloomSaturation.
//   Source SDK 2013 (env_tonemap_controller.cpp, player.cpp): a Set input turns its custom value on until the
//     matching UseDefault input; the player's controller is the first env_tonemap_controller in the map (a
//     trigger_tonemap can hand it another, not handled: no map of ours has one).
// UNSETTLED: the defaults of the tonemap fields when a map never sets them (CS:GO's constructor not decompiled): the
//   SDK 2013 cvar defaults are used (world/exposure-source1.js TONEMAP_DEFAULTS).
// ze_luciddreams_b5: logic_auto OnMapSpawn -> tone.SetAutoExposureMax(1.1), SetAutoExposureMin(0.75), SetBloomScale(2.5).
import { register } from '../registry.js';
import { num } from '../math.js';
import { nameMatches } from '../../../lib/names.js';

const CLS = 'env_tonemap_controller';
const FIELDS = {
  settonemaprate: 'rate',
  settonemappercenttarget: 'percentTarget',
  settonemappercentbrightpixels: 'percentBright',
  settonemapminavglum: 'minAvgLum',
  setbloomexponent: 'bloomExponent',
  setbloomsaturation: 'bloomSaturation',
};

// The map's start-up inputs to it (logic_auto OnMapSpawn / OnMultiNewMap / OnNewGame), applied at spawn: our stages
// start mid-map, so logic_auto never fires (classes/server.js mapCvars reads its cvars the same way)
function startInputs(e) {
  const name = e.name;
  if (!name) return;
  for (const d of Object.values(e.engine.lumps || {}).flat()) {
    if (d?.kv?.classname !== 'logic_auto') continue;
    for (const c of d.io || []) {
      if (/^on(mapspawn|multinewmap|newgame)$/i.test(c.output) && nameMatches(c.target, name)) {
        controller.input(e, String(c.input || '').toLowerCase(), c.param);
      }
    }
  }
}

const controller = register(CLS, {
  spawn(e) { e.state.custom = {}; startInputs(e); },
  input(e, inp, p) {
    const c = e.state.custom;
    const v = num(p, NaN);
    switch (inp) {
      case 'setautoexposuremin': if (Number.isFinite(v)) c.exposureMin = v; return true;
      case 'setautoexposuremax': if (Number.isFinite(v)) c.exposureMax = v; return true;
      case 'usedefaultautoexposure': delete c.exposureMin; delete c.exposureMax; return true;
      case 'setbloomscale': if (Number.isFinite(v)) c.bloomScale = c.bloomScaleMin = v; return true;
      case 'setbloomscalerange': {
        const [hi, lo] = String(p ?? '').trim().split(/\s+/).map(Number);
        if (Number.isFinite(hi) && Number.isFinite(lo)) { c.bloomScale = hi; c.bloomScaleMin = lo; }
        return true;
      }
      case 'usedefaultbloomscale': delete c.bloomScale; delete c.bloomScaleMin; return true;
    }
    if (FIELDS[inp]) { if (Number.isFinite(v)) c[FIELDS[inp]] = v; return true; }
    return false;
  },
});

// The custom values of the player's controller (the map's first live env_tonemap_controller), or null: only the
// fields the map has set, the rest stay the engine's defaults
export function tonemapSettings(engine) {
  const list = engine?.byClass?.get(CLS);
  if (!list) return null;
  for (const e of list) if (e.alive) return e.state.custom || null;
  return null;
}
