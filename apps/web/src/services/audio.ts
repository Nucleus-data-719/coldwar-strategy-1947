/**
 * Sound for the game, generated in the browser with the Web Audio API.
 * No audio files are needed: every effect and the music loop are synthesized, so nothing to download or license.
 * Browsers only allow sound after a click, so the audio context starts on the first user gesture.
 */

export type Sfx =
  | 'click'
  | 'select'
  | 'confirm'
  | 'warn'
  | 'build'
  | 'recruit'
  | 'research'
  | 'march'
  | 'battle'
  | 'victory'
  | 'defeat'
  | 'alert'
  | 'war';

interface Settings {
  sfx: boolean;
  music: boolean;
  sfxVolume: number;
  musicVolume: number;
}

const KEY = 'cw1950.audio';
const defaults: Settings = { sfx: true, music: false, sfxVolume: 0.7, musicVolume: 0.35 };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* storage can be blocked; fall back to defaults */
  }
  return { ...defaults };
}

let settings = load();
let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfxVolume;
    sfxBus.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = settings.music ? settings.musicVolume : 0;
    musicBus.connect(ctx.destination);
    const len = ctx.sampleRate * 1;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** A single tone with a quick envelope. */
function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, bus?: GainNode | null) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(bus ?? sfxBus!);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** A burst of filtered noise: gunfire, explosions, wind. */
function noise(start: number, dur: number, gain: number, freq: number, q = 0.7, type: BiquadFilterType = 'lowpass') {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, start);
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq / 4), start + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  s.connect(f).connect(g).connect(sfxBus!);
  s.start(start);
  s.stop(start + dur + 0.02);
}

const RECIPES: Record<Sfx, (t: number) => void> = {
  click: (t) => tone(620, t, 0.05, 'square', 0.05, 420),
  select: (t) => {
    tone(440, t, 0.06, 'triangle', 0.09);
    tone(660, t + 0.045, 0.08, 'triangle', 0.08);
  },
  confirm: (t) => {
    tone(392, t, 0.09, 'triangle', 0.12);
    tone(587, t + 0.07, 0.14, 'triangle', 0.12);
  },
  warn: (t) => {
    tone(220, t, 0.14, 'sawtooth', 0.09, 160);
    tone(165, t + 0.1, 0.2, 'sawtooth', 0.09, 120);
  },
  // Hammer on steel, twice.
  build: (t) => {
    for (const d of [0, 0.16]) {
      noise(t + d, 0.06, 0.35, 5000, 4, 'bandpass');
      tone(900, t + d, 0.1, 'square', 0.06, 300);
    }
  },
  // Boots: a short marching beat and a rifle bolt click.
  recruit: (t) => {
    for (const d of [0, 0.12, 0.24]) noise(t + d, 0.07, 0.3, 700, 1);
    tone(1800, t + 0.38, 0.03, 'square', 0.06);
    tone(1200, t + 0.42, 0.03, 'square', 0.06);
  },
  research: (t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.08, 0.2, 'sine', 0.11));
  },
  // Radio static blip, then a low engine note.
  march: (t) => {
    noise(t, 0.12, 0.2, 3500, 2, 'bandpass');
    tone(110, t + 0.05, 0.28, 'sawtooth', 0.07, 80);
  },
  battle: (t) => {
    noise(t, 0.5, 0.9, 900, 0.7);
    tone(70, t, 0.45, 'sine', 0.35, 35);
    for (let i = 0; i < 6; i++) noise(t + 0.15 + i * 0.07 + Math.random() * 0.03, 0.05, 0.25, 3000, 2, 'bandpass');
  },
  victory: (t) => {
    [392, 392, 523, 659, 784].forEach((f, i) => {
      tone(f, t + i * 0.14, 0.22, 'square', 0.07);
      tone(f / 2, t + i * 0.14, 0.22, 'triangle', 0.1);
    });
  },
  defeat: (t) => {
    [330, 294, 262, 196].forEach((f, i) => tone(f, t + i * 0.22, 0.34, 'triangle', 0.14, f * 0.97));
  },
  // Two-tone telex alert.
  alert: (t) => {
    tone(880, t, 0.09, 'sine', 0.12);
    tone(660, t + 0.12, 0.14, 'sine', 0.12);
  },
  war: (t) => {
    // Air-raid style siren swell.
    tone(300, t, 0.8, 'sawtooth', 0.09, 620);
    tone(620, t + 0.8, 0.6, 'sawtooth', 0.09, 300);
    tone(55, t, 1.4, 'sine', 0.22, 45);
  },
};

let lastPlayed: Partial<Record<Sfx, number>> = {};

export function playSfx(name: Sfx) {
  if (!settings.sfx) return;
  const c = ensure();
  if (!c) return;
  // Never stack the same sound faster than 60 ms.
  const now = c.currentTime;
  if ((lastPlayed[name] ?? -1) > now - 0.06) return;
  lastPlayed[name] = now;
  RECIPES[name](now + 0.005);
}

/* ---------- Music: a slow, tense generated theme in D minor ---------- */

let musicTimer: number | null = null;
let step = 0;
const BAR_SECONDS = 4.8;
// Chord roots (Hz) for a four-bar loop: Dm, Bb, Gm, A.
const CHORDS: { root: number; notes: number[] }[] = [
  { root: 73.42, notes: [293.66, 349.23, 440.0] },
  { root: 58.27, notes: [233.08, 293.66, 349.23] },
  { root: 49.0, notes: [196.0, 233.08, 293.66] },
  { root: 55.0, notes: [220.0, 277.18, 329.63] },
];

function pad(freq: number, start: number, dur: number) {
  const c = ctx!;
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(0.07, start + 1.4);
  g.gain.linearRampToValueAtTime(0.0001, start + dur);
  g.connect(f).connect(musicBus!);
  for (const det of [-4, 4]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(g);
    o.start(start);
    o.stop(start + dur + 0.1);
  }
}

function scheduleBar() {
  const c = ctx;
  if (!c || !musicBus) return;
  const start = c.currentTime + 0.05;
  const chord = CHORDS[step % CHORDS.length];
  // Drone.
  tone(chord.root, start, BAR_SECONDS, 'sine', 0.22, undefined, musicBus);
  // Pad.
  chord.notes.forEach((n) => pad(n, start, BAR_SECONDS + 0.8));
  // Snare-like march: soft taps on beats 2 and 4 of a slow 4/4, brushed noise.
  for (let beat = 0; beat < 4; beat++) {
    const t = start + (beat * BAR_SECONDS) / 4;
    if (beat % 2 === 1) {
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      const g = c.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      s.connect(f).connect(g).connect(musicBus);
      s.start(t);
      s.stop(t + 0.15);
    } else {
      tone(chord.root * 1.0, t, 0.25, 'sine', 0.18, chord.root * 0.6, musicBus);
    }
  }
  // Sparse lead: two plucked notes from the chord an octave up.
  const picks = [chord.notes[(step * 2) % 3], chord.notes[(step * 2 + 1) % 3]];
  picks.forEach((n, i) => tone(n * 2, start + 1.2 + i * 1.8, 1.1, 'triangle', 0.05, undefined, musicBus));
  step += 1;
}

function startMusic() {
  const c = ensure();
  if (!c || musicTimer !== null) return;
  scheduleBar();
  musicTimer = window.setInterval(scheduleBar, BAR_SECONDS * 1000);
}

function stopMusic() {
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
}

/** Fade the music bus in or out, and run or stop the generator. */
function applyMusic() {
  if (!ctx || !musicBus) return;
  const now = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(now);
  musicBus.gain.setValueAtTime(musicBus.gain.value, now);
  musicBus.gain.linearRampToValueAtTime(settings.music ? settings.musicVolume : 0, now + 0.8);
  if (settings.music) startMusic();
  else window.setTimeout(() => !settings.music && stopMusic(), 900);
}

export function getAudioSettings(): Settings {
  return settings;
}

export function setAudio(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  save();
  if (ctx) {
    if (sfxBus) sfxBus.gain.value = settings.sfxVolume;
    applyMusic();
  } else if (settings.music) {
    ensure();
    applyMusic();
  }
}

export function subscribeAudio(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Call once. Starts audio on the first click and gives every button a sound. */
export function installAudio() {
  const unlock = () => {
    ensure();
    if (settings.music) applyMusic();
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('button');
      if (!el || (el as HTMLButtonElement).disabled) return;
      if (el.classList.contains('danger')) playSfx('warn');
      else if (el.classList.contains('primary')) playSfx('confirm');
      else playSfx('click');
    },
    true,
  );
}

/** Which sound goes with each kind of server notification. */
export function sfxForNotification(type: string): Sfx {
  if (type.startsWith('war')) return 'war';
  if (type === 'research_done') return 'research';
  if (type === 'building_complete' || type === 'local_factory' || type === 'recruitment_center') return 'build';
  if (type === 'recruited' || type === 'unit_ready') return 'recruit';
  if (type === 'general_defeated' || type === 'capital_move_failed') return 'defeat';
  if (type === 'general_level' || type === 'capital_moved' || type === 'alliance') return 'victory';
  return 'alert';
}
