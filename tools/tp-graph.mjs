#!/usr/bin/env node
// CS2's player animation graph, baked for web/src/world/anim-graph/ (README "The player's body"):
//   web/public/player/anim/skeleton.json      the worldmodel skeleton: bones, parents, reference pose, bone masks
//   web/public/player/anim/<graph>.json        one per graph (the player's worldmodel.vnmgraph and every graph it
//                                              references: locomotion per weapon class, actions per weapon ...):
//                                              { graph: <its compiled definition>, clips: { <vnmclip path>: clip } }
//   web/public/player/anim/index.json          { root, graphs: [names] }
// Clips stay in CS2's own compressed form (Esoterica's: 48-bit quaternions, 16-bit ranged translations / scales),
// decoded at runtime by world/anim-graph/clip.js exactly as CS2 samples them.
//
// Pipeline: tools/vpk.mjs pulls the compiled files out of pak01, tools/kv3dump (a VRF newer than the bake's: CS2's
// graphs use KV3 type 26) turns them into KV3 text, tools/kv3.mjs parses that.
//
//   node tools/tp-graph.mjs [out dir]      (LASERS_VRF_DIR: see tools/kv3dump/kv3dump.csproj)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openVpk } from './vpk.mjs';
import { parseKv3 } from './kv3.mjs';
import { cs2Dir } from './steam.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const OUT = path.resolve(process.argv[2] || path.join(REPO, 'web', 'public', 'player', 'anim'));
const ROOT_GRAPH = 'animation/graphs/worldmodel/worldmodel.vnmgraph';
const SKELETON = 'animation/skeletons/characters/worldmodel.vnmskel';
const DUMP_EXE = path.join(REPO, '.work', 'kv3dump', process.platform === 'win32' ? 'kv3dump.exe' : 'kv3dump');

const cs2 = cs2Dir();
if (!cs2) { console.error('CS2 not found (tools/steam.mjs; set LASERS_CS2)'); process.exit(1); }
if (!fs.existsSync(DUMP_EXE)) {
  console.log('building tools/kv3dump ...');
  execFileSync('dotnet', ['build', path.join(HERE, 'kv3dump'), '-c', 'Release', '-o', path.dirname(DUMP_EXE)], { stdio: 'inherit' });
}
const vpk = openVpk(path.join(cs2, 'pak01_dir.vpk'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lasers-graph-'));
const raw = path.join(work, 'raw'), txt = path.join(work, 'kv3');

// resource paths are compiled names + "_c"; graph variations look like "x.vnmgraph+knife.vnmgraph"
const safeRel = (p) => {
  const rel = String(p).replace(/\\/g, '/');
  if (!/^[a-z0-9_./+\-]+$/i.test(rel) || rel.includes('..') || rel.startsWith('/')) throw new Error(`unsafe resource path: ${p}`);
  return rel;
};
// extract + dump a batch of resources; returns path -> parsed KV3 (missing ones are left out)
function dump(paths) {
  fs.rmSync(raw, { recursive: true, force: true });
  fs.rmSync(txt, { recursive: true, force: true });
  let n = 0;
  for (const p of paths) {
    const rel = safeRel(p) + '_c';
    const bytes = vpk.read(rel);
    if (!bytes) { console.warn(`  not in pak01: ${rel}`); continue; }
    const dest = path.join(raw, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    n++;
  }
  if (!n) return new Map();
  try { execFileSync(DUMP_EXE, [raw, txt], { stdio: ['ignore', 'ignore', 'inherit'] }); } catch { /* per-file failures are printed */ }
  const out = new Map();
  for (const p of paths) {
    const f = path.join(txt, ...(safeRel(p) + '_c.kv3').split('/'));
    if (fs.existsSync(f)) out.set(p, parseKv3(fs.readFileSync(f, 'utf8')));
  }
  return out;
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const range = (r) => [r5(r.m_flRangeStart), r5(r.m_flRangeLength)];
// a compiled clip -> what clip.js samples
function packClip(c) {
  const tracks = c.m_trackCompressionSettings.map((t) => [
    (t.m_bIsRotationStatic ? 1 : 0) | (t.m_bIsTranslationStatic ? 2 : 0) | (t.m_bIsScaleStatic ? 4 : 0),
    ...t.m_constantRotation.map(r5), ...range(t.m_translationRangeX), ...range(t.m_translationRangeY),
    ...range(t.m_translationRangeZ), ...range(t.m_scaleRange),
  ]);
  const data = c.m_compressedPoseData instanceof Uint8Array ? c.m_compressedPoseData : new Uint8Array(0);
  const sync = (c.m_syncTrack?.m_syncEvents || []).map((e) => [e.m_ID || '', r5(e.m_startTime?.m_flValue ?? 0), r5(e.m_duration?.m_flValue ?? 0)]);
  const events = (c.m_events || []).map((e) => ({
    cls: String(e._class || '').replace(/^CNm/, ''), t: r5(e.m_flStartTime?.m_flValue ?? 0), d: r5(e.m_flDuration?.m_flValue ?? 0),
    id: e.m_ID ?? e.m_syncID ?? '', sync: e.m_syncID || undefined, id2: e.m_secondaryID || undefined,
    ...(e.m_phase != null ? { phase: e.m_phase } : {}),
  }));
  return {
    duration: r5(c.m_flDuration), frames: c.m_nNumFrames, additive: !!c.m_bIsAdditive,
    tracks, offsets: c.m_compressedPoseOffsets || [], data: Buffer.from(data).toString('base64'),
    sync, syncOffset: c.m_syncTrack?.m_nStartEventOffset || 0, events,
  };
}
const graphName = (p) => safeRel(p).split('/').pop().replace(/\.vnmgraph/g, '').replace(/^\+/, '');

// --- skeleton
const sk = dump([SKELETON]).get(SKELETON);
if (!sk) { console.error('no skeleton'); process.exit(1); }
const masks = {};
for (const m of sk.m_maskDefinitions || []) {
  const w = m.m_primaryWeightList || {};
  masks[m.m_ID] = Object.fromEntries((w.m_boneIDs || []).map((b, i) => [b, w.m_weights?.[i] ?? 1]));
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'skeleton.json'), JSON.stringify({
  source: SKELETON, bones: sk.m_boneIDs, parents: sk.m_parentIndices,
  refPose: sk.m_parentSpaceReferencePose.map((t) => t.map(r5)), // [tx, ty, tz, scale, qx, qy, qz, qw] per bone
  lowLodBones: sk.m_numBonesToSampleAtLowLOD, masks,
}));
console.log(`skeleton: ${sk.m_boneIDs.length} bones, ${Object.keys(masks).length} masks`);

// --- graphs, breadth first from the root
const done = new Set(), names = [];
let queue = [ROOT_GRAPH], totalClips = 0, bytes = 0;
while (queue.length) {
  const batch = queue.filter((g) => !done.has(g));
  queue = [];
  batch.forEach((g) => done.add(g));
  const graphs = dump(batch);
  for (const [gp, g] of graphs) {
    const clipPaths = g.m_resources.filter((r) => typeof r === 'string' && r.endsWith('.vnmclip'));
    for (const r of g.m_resources) if (typeof r === 'string' && r.endsWith('.vnmgraph') && !done.has(r)) queue.push(r);
    const clips = dump(clipPaths);
    const out = { source: gp, graph: g, clips: {} };
    for (const [cp, c] of clips) out.clips[cp] = packClip(c);
    const name = graphName(gp);
    const file = path.join(OUT, `${name}.json`);
    const json = JSON.stringify(out);
    fs.writeFileSync(file, json);
    names.push(name);
    totalClips += clips.size;
    bytes += json.length;
    console.log(`  ${name}: ${g.m_nodes.length} nodes, ${clips.size}/${clipPaths.length} clips, ${(json.length / 1024).toFixed(0)} KB`);
  }
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ root: graphName(ROOT_GRAPH), graphs: names.sort() }));
vpk.close();
fs.rmSync(work, { recursive: true, force: true });
console.log(`${names.length} graphs, ${totalClips} clips, ${(bytes / 1048576).toFixed(1)} MB -> ${OUT}`);
