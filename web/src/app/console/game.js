// The game's convars and commands. CS2's own names where CS2 has the thing (sensitivity, volume, snd_musicvolume,
// r_fullscreen_gamma, cl_showfps, thirdperson, kill, map, status, getpos, buy ...), with CS2's help text where its
// binaries carry one (client.dll, soundsystem.dll, rendersystemdx11.dll, engine2.dll); this site's own knobs are ze_*.
// Settings-backed convars write through app/settings.js (range-clamped, saved, the menu's controls redrawn).
//
//   registerGame({ net, restart, openMap, leaveRun })   main.js passes what only it has
import * as THREE from 'three';
import { defineCvar, defineCommand } from './registry.js';
import { S, G } from '../state.js';
import { settings, saveSettings, syncControls, DEFAULTS, RANGES, M_YAW } from '../settings.js';
import { finish, stageTime } from '../session.js';
import { godMode } from '../rules.js';
import { buyWeapon } from '../buy.js';
import { GUNS } from '../../lib/weapons.js';
import { fps } from '../perf.js';
import { simulatedPing, pingLocked } from '../coop-load.js';
import { formatTime } from '../../lib/format.js';
import { lastReport } from './run-report.js';

// a cheat changes your solo game only: a round plays by the room's rules (app/rules.js), as a server's sv_cheats 0 does
const CHEAT_OFF = (name) => (S.mp ? `Convar ${name} is marked as cheat and cheats are off (a round plays by the room's rules)` : '');
const CHEAT_CMD = (name) => (S.mp ? `Cheat command '${name}' ignored: a round plays by the room's rules` : '');

function setting(key, v) {
  settings[key] = v;
  saveSettings();
  syncControls();
  G.applySettings?.();
}

// a convar over settings[key]; to / from map between the convar's value and the setting's when they differ
function settingCvar(name, key, { help, type = 'float', flags = ['archive'], to = (v) => v, from = (v) => v, ...rest }) {
  const range = RANGES[key];
  const cheat = flags.includes('cheat');
  defineCvar({
    name, help, type, flags, def: from(DEFAULTS[key]), min: range?.[0], max: range?.[1], ...rest,
    get: () => from(settings[key]),
    set: (v) => setting(key, to(v)),
    guard: cheat ? () => CHEAT_OFF(name) : undefined,
  });
}

export function registerGame({ net, restart, openMap, leaveRun }) {
  // ---- convars
  settingCvar('sensitivity', 'sens', { help: 'Mouse sensitivity.' });
  defineCvar({ name: 'm_yaw', help: 'Mouse yaw factor.', flags: ['archive', 'readonly'], def: M_YAW, get: () => M_YAW });
  defineCvar({ name: 'm_pitch', help: 'Mouse pitch factor.', flags: ['archive', 'readonly'], def: M_YAW, get: () => M_YAW });
  // CS2's `volume` is the master, over effects, music and voice (each its own slider under it in Settings › Audio)
  settingCvar('volume', 'master', { help: 'Master volume: scales effects, music and voice' });
  settingCvar('snd_sfxvolume', 'sfx', { help: 'Effects volume: lasers, weapons, footsteps' });
  settingCvar('snd_musicvolume', 'music', { help: 'Music volume' });
  settingCvar('snd_voipvolume', 'voice', { help: 'Voice volume' });
  settingCvar('r_fullscreen_gamma', 'gamma', { help: 'Screen Gamma (lower is brighter; CS2\'s default is 2.2)' });
  settingCvar('cl_showfps', 'perfMeter', { help: 'Draw fps meter at top of screen (1 = fps, and ping in a room)', type: 'int', min: 0, max: 1, to: (v) => v > 0, from: (v) => (v ? 1 : 0) });
  // app/loop.js scheduleFrame; the menu's "Screen refresh" is -1 here
  settingCvar('fps_max', 'fpsMax', { help: 'Frame rate limiter. 0=no limit; -1=the display\'s refresh rate.', type: 'int' });
  settingCvar('cam_idealdist', 'tpDist', { help: 'Third person camera distance (CS2Fixes\' default 65)' });
  settingCvar('sv_autobunnyhopping', 'autoBhop', { help: 'Players automatically re-jump while holding jump button', type: 'bool', flags: ['cheat'] });
  settingCvar('host_timescale', 'timescale', { help: 'Game speed, solo (T toggles 0.25)', flags: ['cheat'] });
  settingCvar('ze_hitboxes', 'hitboxes', { help: 'Draw the hazards\' hitboxes (H)', type: 'bool', flags: ['archive', 'cheat'] });
  settingCvar('ze_falldamage', 'fallDamage', { help: 'Fall damage everywhere, not only where the map turns it on', type: 'bool', flags: ['archive', 'cheat'] });
  // the same value as Settings › Game "Simulated ping" and the room screen's slider (ui/room.js): both redrawn, the room
  // told; reads the ping in effect (a round's, locked at its start: app/coop-load.js), and can't change it then
  defineCvar({
    name: 'c_simulated_ping', type: 'int', flags: ['archive'], def: DEFAULTS.ping, min: RANGES.ping[0], max: RANGES.ping[1],
    help: 'Simulated ping (ms): lasers come this late; lag compensation allows for it',
    get: () => simulatedPing(),
    set: (v) => { setting('ping', v); G.room?.sync(); G.room?.sendPing(); },
    guard: () => (pingLocked() ? `c_simulated_ping is locked until the round ends (${simulatedPing()} ms)` : ''),
  });
  settingCvar('ze_minimap', 'minimap', { help: 'CS2\'s radar, top left, on maps that ship an overview', type: 'bool' });
  settingCvar('ze_bosshp', 'bossHp', { help: 'Percent of the boss HP to fight through, solo', type: 'int' });

  // ---- commands
  defineCommand({ name: 'thirdperson', help: 'Switch to thirdperson camera.', run: () => { setting('thirdPerson', true); } });
  defineCommand({ name: 'firstperson', help: 'Switch to firstperson camera.', run: () => { setting('thirdPerson', false); } });
  defineCommand({
    name: 'god', help: 'Toggle. Player becomes invulnerable. (G)', flags: ['cheat'], guard: () => CHEAT_CMD('god'),
    run: () => { setting('god', !settings.god); return `godmode ${settings.god ? 'ON' : 'OFF'}`; },
  });
  defineCommand({
    name: 'kill', help: 'Kills the player.',
    run() {
      const run = S.run;
      if (!run || run.done || run.spectating || !run.started || S.replay) return 'kill: not in a running stage';
      run.killedBy = 'suicide';
      finish('dead');
    },
  });
  defineCommand({ name: 'retry', help: 'Restart the stage (in a room, the owner restarts the round). (Backspace)', run: () => { restart(); } });
  defineCommand({
    name: 'disconnect', help: 'Leave the room, or the stage you are in.',
    run() {
      if (net.inRoom) { net.leave(); return 'Disconnected from the room'; }
      if (!S.run) return 'disconnect: not in a stage';
      leaveRun();
    },
  });
  defineCommand({
    name: 'map', usage: '<mapname>', help: 'Load a map and show its stages.',
    complete: () => S.mapIndex.map((m) => m.name),
    run(args) {
      if (args.length < 2) return [`Current map: ${S.map?.name || 'none'}`, 'Usage:  map <mapname>   (Tab lists them)'];
      const name = args[1].toLowerCase();
      if (!S.mapIndex.some((m) => m.name === name)) return `map: ${name} isn't a baked map here`;
      openMap(name);
    },
  });
  defineCommand({
    name: 'stage', usage: '<id | number> [endless]', help: 'Start a stage of this map (stage alone lists them).',
    complete: (args) => (args.length === 2 ? S.scenarios.map((s) => s.id).filter(Boolean) : args.length === 3 ? ['endless'] : []),
    run(args) {
      if (!S.map) return 'stage: pick a map first (map <name>)';
      if (args.length < 2) return S.scenarios.map((s, i) => `${String(i + 1).padStart(2)}  ${s.id}  ${s.name}${s.endless ? '  (endless)' : ''}`);
      const n = Number(args[1]);
      const i = Number.isInteger(n) ? n - 1 : S.scenarios.findIndex((s) => s.id === args[1]);
      const sc = S.scenarios[i];
      if (!sc) return `stage: no stage ${args[1]} on ${S.map.name}`;
      const endless = args[2] === 'endless';
      if (endless && !sc.endless) return `stage: ${sc.id} has no endless mode`;
      G.play(i, endless ? 'endless' : 'normal');
    },
  });
  defineCommand({
    name: 'buy', usage: '<weapon>', help: 'Buy a gun, as !<gun> in chat does.',
    complete: () => Object.keys(GUNS).map((n) => n.replace(/^weapon_/, '')),
    run: (args) => (args.length < 2 ? 'Usage:  buy <weapon>' : buyWeapon(args[1]).reply),
  });
  defineCommand({
    name: 'getpos', help: 'dump position and angles to the console',
    run() {
      const p = S.player;
      if (!p) return 'getpos: no player yet';
      const f = (v) => v.toFixed(6);
      return `setpos ${p.origin.map(f).join(' ')};setang ${f(p.pitch)} ${f(p.yaw)} ${f(0)}`;
    },
  });
  defineCommand({ name: 'ping', help: 'Display ping to server.', run: () => (net.inRoom ? `${net.rtt || '-'} ms to the room's server (simulated ping ${simulatedPing()} ms)` : `Not in a room (simulated ping ${simulatedPing()} ms)`) });
  defineCommand({ name: 'status', help: 'Display map and connection status.', run: () => status(net) });
  defineCommand({
    name: 'stats', help: 'The last run\'s report (lasers dodged, damage taken ...), or the one in progress.',
    run() {
      const run = S.run;
      if (run && !run.done && run.dodges) {
        const d = run.dodges;
        return [`In progress: ${formatTime(stageTime())} · ${run.hits} hits`,
          `Dodged: ${d.dodged.laser} lasers · ${d.dodged.ball} balls · ${d.dodged.hazard} other`];
      }
      return lastReport() || 'stats: no run yet';
    },
  });
  defineCommand({ name: 'version', help: 'Print version info string.', run: () => `ZE Laser Practice · three.js r${THREE.REVISION} · ${navigator.userAgent}` });
}

function status(net) {
  const { run, scenario, player, engine } = S;
  const out = [];
  out.push(`server  : ${net.inRoom ? `room ${net.room.code}${net.isHost ? ' (you own it)' : ''}` : 'solo (this browser)'}`);
  out.push(`map     : ${S.map?.name || 'none'}${S.map && !S.map.loaded ? ' (stage list only)' : ''}`);
  if (run) {
    const t = run.started ? formatTime(stageTime()) : 'countdown';
    out.push(`stage   : ${scenario?.name || 'Free roam'}${run.endless ? ' · endless' : ''} · ${t} · seed ${run.seed}${run.done ? ` · over (${run.result})` : ''}`);
    out.push(`player  : ${Math.round(run.hp)} hp · ${run.armor} armor · $${run.money} · ${G.vm?.gunName || ''} (${G.vm?.weapon || ''})${godMode() ? ' · god' : ''}`);
  }
  if (player) {
    const sp = Math.hypot(player.velocity[0], player.velocity[1]);
    out.push(`pos     : ${player.origin.map((v) => v.toFixed(1)).join(' ')} · ${Math.round(sp)} u/s${player.onGround ? '' : ' · in the air'}`);
  }
  if (engine) out.push(`entities: ${engine.ents.filter((e) => e.alive).length} · map time ${engine.time.toFixed(2)} s`);
  out.push(`fps     : ${fps() || '-'}`);
  out.push(`net     : ${net.status}${net.inRoom ? ` · rtt ${net.rtt || '-'} ms` : ''} · simulated ping ${simulatedPing()} ms`);
  if (net.inRoom) {
    const r = net.room;
    out.push(`players : ${r.members.length}`);
    for (const m of r.members) out.push(`  #${m.id} ${m.name}${m.id === r.owner ? ' (owner)' : ''}${m.id === net.you ? ' (you)' : ''}`);
  }
  return out;
}
