// The baked anim graphs on the server (public/player/anim/, tools/tp-graph.mjs): the skeleton and the player's root
// graph load first; every other graph (a weapon's actions, a class's locomotion) is fetched the first time a graph
// asks for it, and is used from then on (until it arrives the asking node falls back, as a missing graph does in CS2).
import { fetchJson } from '../../lib/fetch.js';
import { makeSkeleton } from './graph.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}player/anim/`;
const SAFE = /^[a-z0-9_+]+$/i;

// a graph resource path -> its baked file name ("…/worldmodel_gun.vnmgraph+ak47.vnmgraph" -> "worldmodel_gun+ak47")
export const graphName = (path) => String(path).split('/').pop().replace(/\.vnmgraph/g, '').replace(/^\+/, '');

export class AnimLibrary {
  constructor(log = () => {}) { this.log = log; this.files = new Map(); this.pending = new Map(); this.known = null; }

  async load(preload = []) {
    const [skel, index] = await Promise.all([fetchJson(BASE + 'skeleton.json'), fetchJson(BASE + 'index.json')]);
    this.skel = makeSkeleton(skel);
    this.known = new Set(index.graphs.filter((n) => SAFE.test(n)));
    this.rootName = index.root;
    await Promise.all([index.root, ...preload].map((n) => this.fetch(n)));
    return this;
  }

  fetch(name) {
    if (!this.known?.has(name)) return Promise.resolve(null);
    if (this.files.has(name)) return Promise.resolve(this.files.get(name));
    if (!this.pending.has(name)) {
      this.pending.set(name, fetchJson(`${BASE}${name}.json`).then((f) => { this.files.set(name, f); return f; },
        (e) => { this.log(`anim graph ${name}: ${e.message || e}`); this.files.set(name, null); return null; }));
    }
    return this.pending.get(name);
  }

  // for GraphInstance: the file if it is here, else null (and it starts loading)
  graph(path) {
    const name = graphName(path);
    if (this.files.has(name)) return this.files.get(name);
    this.fetch(name);
    return null;
  }
  get root() { return this.files.get(this.rootName); }
}
