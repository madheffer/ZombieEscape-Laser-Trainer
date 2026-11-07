// Sync tracks: how CS2's anim graph keeps blended clips in step (a walk and a run both "left foot down" at the same
// moment). A track is a list of events covering the clip, each { id, start, duration } in percentages of the clip.
// A sync time is { idx, pct }: which event and how far through it. Ported from Esoterica's AnimationSyncTrack
// (github.com/BobbyAnguelov/Esoterica, the runtime CS2's NmGraph comes from).

const modf = (v) => { const i = Math.trunc(v); return [i, v - i]; };
const normalized = (v) => { const [loops, n] = modf(v); return loops > 0 && n === 0 ? 1 : n; };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
export const lcm = (a, b) => (a / gcd(a, b)) * b;

export const syncTime = (idx = 0, pct = 0) => ({ idx, pct });
export const syncRange = (start, end = start) => ({ start, end });

export class SyncTrack {
  // events: [{ id, start, duration }] (a clip's compiled track) or nothing (one event over the whole clip)
  constructor(events = null, startOffset = 0) {
    this.events = events?.length ? events.map((e) => ({ ...e })) : [{ id: '', start: 0, duration: 1 }];
    this.offset = this.clampIdx(startOffset);
  }

  // the two tracks of a blend, weighted (Esoterica's SyncTrack(track0, track1, w))
  static blend(a, b, w) {
    const n0 = a.events.length, n1 = b.events.length, L = lcm(n0, n1);
    const s0 = n0 / L, s1 = n1 / L;
    const t = new SyncTrack();
    t.events = [];
    let start = 0;
    for (let i = 0; i < L; i++) {
      const e0 = a.event(i), e1 = b.event(i);
      const d = e0.duration * s0 + (e1.duration * s1 - e0.duration * s0) * w;
      t.events.push({ id: w > 0.5 ? e1.id : e0.id, start, duration: d });
      start += d;
    }
    const k = 1 / start;
    for (const e of t.events) { e.start *= k; e.duration *= k; }
    t.events[L - 1].duration = 1 - t.events[L - 1].start;
    t.offset = 0;
    return t;
  }

  get count() { return this.events.length; }
  clampIdx(i) { const n = this.events.length; let c = i % n; if (c < 0) c += n; return c; }
  event(i) { return this.events[this.clampIdx(i + this.offset)]; }
  eventIndexForId(id) {
    for (let i = 0; i < this.events.length; i++) if (this.events[i].id === id) return this.clampIdx(i - this.offset);
    return this.offset;
  }
  startTime() { return syncTime(0, 0); }
  endTime() { return syncTime(this.events.length - 1, 1); }

  // percentage through the clip -> sync time
  time(pct, withOffset = true) {
    const ev = this.events, n = ev.length;
    if (pct === 1) return syncTime(n - 1, 1);
    const [loops, p] = modf(pct);
    const t = syncTime();
    if (p < ev[0].start) {
      t.idx = n - 1;
      t.pct = (ev[n - 1].duration - (ev[0].start - p)) / ev[n - 1].duration;
    } else {
      for (let i = 0; i < n; i++) {
        if (ev[i].start + ev[i].duration >= p) { t.idx = i; t.pct = (p - ev[i].start) / ev[i].duration; break; }
      }
    }
    t.idx = this.clampIdx(t.idx + loops * n - (withOffset ? this.offset : 0));
    return t;
  }

  // sync time -> percentage through the clip
  percentage(t, withOffset = true) {
    const e = this.events[this.clampIdx(t.idx + (withOffset ? this.offset : 0))];
    const p = e.start + e.duration * t.pct;
    return p > 1 ? normalized(p) : p;
  }

  // how much of the clip a sync range covers (0..1, looping ranges wrap)
  percentageCovered(start, end) {
    let d;
    if (start.idx === end.idx && start.pct < end.pct) d = end.pct - start.pct;
    else {
      d = 1 - start.pct;
      let i = start.idx + 1, guard = 0;
      while (i !== end.idx && guard++ < 4096) {
        if (i === this.events.length) i = 0;
        else { d += 1; i++; }
      }
      d += end.pct;
    }
    return d / this.events.length;
  }
}

// how long a sync-blended pair lasts (Esoterica SyncTrack::CalculateDurationSynchronized)
export function syncedDuration(d0, d1, n0, n1, L, w) {
  const a = d0 * (L / n0), b = d1 * (L / n1);
  return a + (b - a) * w;
}

export const DEFAULT_TRACK = new SyncTrack();
