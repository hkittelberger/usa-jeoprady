// TV audio. Uses /audio/*.mp3 overrides when present, otherwise
// synthesizes original fallbacks with the Web Audio API.

type Slot = "think" | "sting" | "buzzer" | "ding";
const FILES: Record<Slot, string> = {
  think: "/audio/think.mp3",
  sting: "/audio/daily-double.mp3",
  buzzer: "/audio/buzzer.mp3",
  ding: "/audio/ding.mp3",
};

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private overrides: Partial<Record<Slot, AudioBuffer>> = {};
  private thinkBuffer: AudioBuffer | null = null;
  private thinkSrc: AudioBufferSourceNode | null = null;
  private thinkGain: GainNode | null = null;
  private muted = false;

  get unlocked() { return !!this.ctx && this.ctx.state === "running"; }

  async unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      void this.loadOverrides();
      void this.renderThink().then((b) => { this.thinkBuffer = b; });
    }
    await this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  private async loadOverrides() {
    await Promise.all((Object.keys(FILES) as Slot[]).map(async (slot) => {
      try {
        const r = await fetch(FILES[slot], { cache: "no-cache" });
        const type = r.headers.get("content-type") ?? "";
        if (!r.ok || !(type.startsWith("audio/") || type === "application/octet-stream")) return;
        this.overrides[slot] = await this.ctx!.decodeAudioData(await r.arrayBuffer());
      } catch { /* fall back to synth */ }
    }));
  }

  private playBuffer(buf: AudioBuffer, loop = false, gain = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master!);
    src.start();
    return { src, g };
  }

  // ----- think music -----
  async startThink() {
    if (!this.ctx) return;
    this.stopThink();
    const buf = this.overrides.think ?? this.thinkBuffer ?? (this.thinkBuffer = await this.renderThink());
    if (this.thinkSrc) return;
    const { src, g } = this.playBuffer(buf, true, 0.8);
    this.thinkSrc = src;
    this.thinkGain = g;
  }

  stopThink() {
    if (!this.thinkSrc || !this.ctx) return;
    const src = this.thinkSrc, g = this.thinkGain!;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    src.stop(this.ctx.currentTime + 0.3);
    this.thinkSrc = null;
    this.thinkGain = null;
  }

  /** Renders an original, upbeat 8-bar loop (~14.5s) into a buffer. */
  private async renderThink(): Promise<AudioBuffer> {
    const bpm = 132, beat = 60 / bpm, bars = 8, len = bars * 4 * beat;
    const sr = 44100;
    const ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);

    const note = (type: OscillatorType, freq: number, t: number, dur: number, vol: number, cutoff = 4000) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = cutoff;
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.setTargetAtTime(vol * 0.6, t + 0.03, 0.08);
      g.gain.setTargetAtTime(0, t + dur * 0.9, 0.03);
      o.connect(f).connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.2);
    };

    // Melody: [midi note | null, beats]
    const C5 = 72, D5 = 74, E5 = 76, F5 = 77, G5 = 79, A5 = 81, B5 = 83, C6 = 84;
    const melody: [number | null, number][] = [
      [C5, .5], [E5, .5], [G5, 1], [E5, .5], [G5, .5], [C6, 1],
      [A5, .5], [G5, .5], [F5, .5], [A5, .5], [G5, 2],
      [E5, .5], [G5, .5], [C6, 1], [B5, .5], [A5, .5], [G5, 1],
      [A5, .5], [G5, .5], [E5, .5], [D5, .5], [E5, 2],
      [D5, .5], [F5, .5], [A5, 1], [F5, .5], [A5, .5], [D5 + 12, 1],
      [C6, .5], [B5, .5], [A5, .5], [B5, .5], [G5, 2],
      [E5, .5], [G5, .5], [F5, .5], [A5, .5], [G5, .5], [B5, .5], [D5 + 12, 1],
      [C6, 1], [G5, .5], [E5, .5], [C5, 1], [null, 1],
    ];
    let t = 0;
    for (const [n, b] of melody) {
      if (n != null) note("square", midi(n), t, b * beat * 0.92, 0.12, 2600);
      t += b * beat;
    }
    // Bass + chords (one chord per bar): C F C Am Dm G C/G G7→C
    const chords = [[48, 52, 55], [53, 57, 60], [48, 52, 55], [45, 48, 52], [50, 53, 57], [43, 47, 50], [48, 52, 55], [43, 47, 53]];
    chords.forEach((ch, bar) => {
      const t0 = bar * 4 * beat;
      for (let i = 0; i < 4; i++) {
        const root = i % 2 === 0 ? ch[0] - 12 : ch[2] - 12;
        note("triangle", midi(root), t0 + i * beat, beat * 0.8, 0.35, 900);
      }
      // off-beat chord stabs
      for (let i = 0; i < 4; i++) for (const n of ch) note("sawtooth", midi(n + 12), t0 + (i + 0.5) * beat, beat * 0.25, 0.03, 1800);
    });
    // Hi-hat ticks on 8ths, snare on 2 and 4
    const noise = ctx.createBuffer(1, sr * 0.2, sr);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (let i = 0; i < bars * 8; i++) {
      const tt = i * beat / 2;
      const src = ctx.createBufferSource(); src.buffer = noise;
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      const snare = i % 4 === 2;
      f.type = snare ? "bandpass" : "highpass";
      f.frequency.value = snare ? 1800 : 7000;
      g.gain.setValueAtTime(snare ? 0.35 : 0.08, tt);
      g.gain.exponentialRampToValueAtTime(0.001, tt + (snare ? 0.15 : 0.04));
      src.connect(f).connect(g).connect(out);
      src.start(tt); src.stop(tt + 0.2);
    }
    return ctx.startRendering();
  }

  // ----- one-shots -----
  private tone(type: OscillatorType, freq: number, t: number, dur: number, vol: number, opts: { cutoff?: number; detune?: number; decay?: boolean } = {}) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = opts.cutoff ?? 8000;
    o.type = type; o.frequency.value = freq; o.detune.value = opts.detune ?? 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    if (opts.decay) g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    else { g.gain.setValueAtTime(vol, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur); }
    o.connect(f).connect(g).connect(this.master!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  sting() {
    if (!this.ctx) return;
    if (this.overrides.sting) { this.playBuffer(this.overrides.sting); return; }
    const t = this.ctx.currentTime + 0.02;
    const brass = (n: number, at: number, dur: number, vol = 0.12) => {
      this.tone("sawtooth", midi(n), at, dur, vol, { cutoff: 2200 });
      this.tone("sawtooth", midi(n), at, dur, vol * 0.7, { cutoff: 2200, detune: 8 });
    };
    // Rising fanfare G-C-E-G … big C major chord
    [67, 72, 76, 79].forEach((n, i) => brass(n, t + i * 0.13, 0.14));
    [72, 76, 79, 84].forEach((n) => brass(n, t + 0.55, 1.3, 0.1));
    this.tone("triangle", midi(48), t + 0.55, 1.3, 0.4, { cutoff: 600 });
    // shimmer
    for (let i = 0; i < 8; i++) this.tone("sine", midi(96 + (i % 4) * 2), t + 0.55 + i * 0.07, 0.4, 0.04, { decay: true });
  }

  buzzer() {
    if (!this.ctx) return;
    if (this.overrides.buzzer) { this.playBuffer(this.overrides.buzzer); return; }
    const t = this.ctx.currentTime + 0.02;
    this.tone("sawtooth", 98, t, 0.9, 0.3, { cutoff: 1500 });
    this.tone("square", 104, t, 0.9, 0.2, { cutoff: 1500 });
    this.tone("sawtooth", 147, t, 0.9, 0.12, { cutoff: 1500 });
  }

  ding() {
    if (!this.ctx) return;
    if (this.overrides.ding) { this.playBuffer(this.overrides.ding); return; }
    const t = this.ctx.currentTime + 0.02;
    this.tone("sine", 1318.5, t, 1.4, 0.3, { decay: true });
    this.tone("sine", 2637, t, 0.8, 0.1, { decay: true });
    this.tone("sine", 3951, t, 0.4, 0.05, { decay: true });
  }
}

export const audio = new AudioManager();
