// Endless mode keeps a stage going past where the map's music was timed to end: its tracks are one-shots, so the
// round goes silent once the last one finishes. Here, when a music track ends by itself and no other music is
// playing, the next track this run has played starts again from the top (one track: it loops; several: they
// cycle in the order the map started them). A track the map stops itself (StopSound, csgo_music stop_music)
// isn't brought back, and outside endless nothing changes.

const MIN_TRACK = 20; // s: a shorter music event is a sting (a boss-down jingle), not a track to cycle

export class MusicLoop {
  constructor() {
    this.on = false;
    this.tracks = []; // [{ name, o }] in the order they first played
  }

  clear() { this.tracks = []; }

  // a music voice began playing a buffer `duration` s long: remember its track (name + the request), once
  note(name, o, duration) {
    if (!this.on || !(duration >= MIN_TRACK)) return;
    if (this.tracks.some((t) => t.name === name)) return;
    this.tracks.push({ name, o: { ...o, offset: 0, chain: null } });
  }

  // a music voice named `name` ended by itself: the track to start now, or null (other music still plays)
  next(name, voices) {
    if (!this.on || !this.tracks.length) return null;
    for (const v of voices) if (v.music && !v.stopped) return null;
    const i = this.tracks.findIndex((t) => t.name === name);
    // a sting ended with nothing else on: the last track again
    return this.tracks[i < 0 ? this.tracks.length - 1 : (i + 1) % this.tracks.length];
  }
}
