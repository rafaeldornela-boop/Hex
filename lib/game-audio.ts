/**
 * Centralized procedural Web Audio, adaptive music, ambient soundscape,
 * and accessibility/audio preferences manager.
 * Zero external audio files (no 404s, instant lazy loading on demand).
 */

export type MusicState =
  | 'normal'
  | 'prosperity'
  | 'crisis'
  | 'war'
  | 'discovery';

export type AmbientBiome =
  | 'forest'
  | 'water'
  | 'city'
  | 'mining'
  | 'port'
  | 'rain'
  | 'storm'
  | 'night';

export type TextSizeOption = 'normal' | 'large';

export interface GameAudioPreferences {
  masterVolume: number; // 0..1
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  ambientVolume: number; // 0..1
  muted: boolean;
  ambientEnabled: boolean;
  reduceAnimations: boolean;
  reduceEffects: boolean;
  textSize: TextSizeOption;
}

export interface AdaptiveMusicContext {
  atWar: boolean;
  hasCrisis: boolean;
  hasFoodDeficit: boolean;
  lowGold: boolean;
  recentDiscovery: boolean;
  goldNet: number;
  populationGrowth: number;
  cityCount: number;
}

const PREFS_STORAGE_KEY = 'hex_audio_accessibility_prefs_v1';

export const DEFAULT_AUDIO_PREFERENCES: GameAudioPreferences = {
  masterVolume: 0.75,
  musicVolume: 0.42,
  sfxVolume: 0.8,
  ambientVolume: 0.32,
  muted: false,
  ambientEnabled: true,
  reduceAnimations: false,
  reduceEffects: false,
  textSize: 'normal',
};

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

export function normalizeAudioPreferences(
  raw: Partial<GameAudioPreferences> | null | undefined,
  defaults: GameAudioPreferences = DEFAULT_AUDIO_PREFERENCES
): GameAudioPreferences {
  const src = raw ?? {};
  return {
    masterVolume: clamp01(Number(src.masterVolume ?? defaults.masterVolume), defaults.masterVolume),
    musicVolume: clamp01(Number(src.musicVolume ?? defaults.musicVolume), defaults.musicVolume),
    sfxVolume: clamp01(Number(src.sfxVolume ?? defaults.sfxVolume), defaults.sfxVolume),
    ambientVolume: clamp01(Number(src.ambientVolume ?? defaults.ambientVolume), defaults.ambientVolume),
    muted: typeof src.muted === 'boolean' ? src.muted : defaults.muted,
    ambientEnabled:
      typeof src.ambientEnabled === 'boolean' ? src.ambientEnabled : defaults.ambientEnabled,
    reduceAnimations:
      typeof src.reduceAnimations === 'boolean' ? src.reduceAnimations : defaults.reduceAnimations,
    reduceEffects:
      typeof src.reduceEffects === 'boolean' ? src.reduceEffects : defaults.reduceEffects,
    textSize: src.textSize === 'large' ? 'large' : 'normal',
  };
}

/**
 * Pure resolver for adaptive music state from global kingdom metrics.
 */
export function resolveAdaptiveMusicState(ctx: AdaptiveMusicContext): MusicState {
  if (ctx.atWar) return 'war';
  if (ctx.hasCrisis || ctx.hasFoodDeficit || ctx.lowGold) return 'crisis';
  if (ctx.recentDiscovery) return 'discovery';
  if (ctx.goldNet >= 35 && ctx.populationGrowth >= 1 && ctx.cityCount >= 1) {
    return 'prosperity';
  }
  return 'normal';
}

const MUSIC_CHORDS: Record<MusicState, readonly number[]> = {
  normal: [220.0, 277.18, 329.63], // A major warm pastoral
  prosperity: [261.63, 329.63, 392.0, 493.88], // Cmaj7 bright
  crisis: [196.0, 233.08, 293.66], // G minor tense
  war: [146.83, 220.0, 261.63], // D minor/fifth heavy
  discovery: [293.66, 369.99, 440.0, 554.37], // Dmaj7 luminous
};

class HexGameAudio {
  private ctx: AudioContext | null = null;
  private prefs: GameAudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  private prefsLoaded = false;
  private listeners = new Set<(prefs: GameAudioPreferences) => void>();

  // Rate-limiting & polyphony caps
  private lastPlayedAt = new Map<string, number>();
  private activeSfxVoices = 0;
  private readonly maxSfxVoices = 8;

  // Adaptive music nodes (lazy created when music starts)
  private musicMasterGain: GainNode | null = null;
  private musicOscs: OscillatorNode[] = [];
  private musicStarted = false;
  private currentMusicState: MusicState = 'normal';
  private lastMusicSwitchMs = 0;
  private readonly musicHoldMs = 12000;

  // Ambient soundscape nodes
  private ambientMasterGain: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private ambientNoiseSource: AudioBufferSourceNode | null = null;
  private currentAmbient: AmbientBiome = 'forest';
  private ambientStarted = false;

  constructor() {
    this.loadPreferences();
  }

  private loadPreferences() {
    if (this.prefsLoaded) return;
    this.prefsLoaded = true;
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(PREFS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<GameAudioPreferences>;
        this.prefs = normalizeAudioPreferences(parsed);
        return;
      }
      // Respect OS reduced-motion preference on first visit
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const isCoarse =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;
      this.prefs = normalizeAudioPreferences({
        reduceAnimations: prefersReducedMotion,
        ambientVolume: isCoarse ? 0.22 : DEFAULT_AUDIO_PREFERENCES.ambientVolume,
      });
    } catch {
      this.prefs = { ...DEFAULT_AUDIO_PREFERENCES };
    }
  }

  private savePreferences() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // ignore storage quota / privacy mode errors
    }
  }

  getPreferences(): GameAudioPreferences {
    this.loadPreferences();
    return { ...this.prefs };
  }

  updatePreferences(partial: Partial<GameAudioPreferences>): GameAudioPreferences {
    this.loadPreferences();
    this.prefs = normalizeAudioPreferences({ ...this.prefs, ...partial });
    this.savePreferences();
    this.applyBusGains();
    for (const cb of this.listeners) {
      cb({ ...this.prefs });
    }
    return { ...this.prefs };
  }

  resetPreferences(): GameAudioPreferences {
    this.prefs = { ...DEFAULT_AUDIO_PREFERENCES };
    this.savePreferences();
    this.applyBusGains();
    for (const cb of this.listeners) {
      cb({ ...this.prefs });
    }
    return { ...this.prefs };
  }

  subscribePreferences(cb: (prefs: GameAudioPreferences) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  setMuted(nextMuted: boolean) {
    this.updatePreferences({ muted: nextMuted });
  }

  isMuted(): boolean {
    return this.getPreferences().muted;
  }

  private getEffectiveSfxGain(): number {
    if (this.prefs.muted) return 0;
    return this.prefs.masterVolume * this.prefs.sfxVolume;
  }

  private getEffectiveMusicGain(): number {
    if (this.prefs.muted) return 0;
    return this.prefs.masterVolume * this.prefs.musicVolume * 0.14;
  }

  private getEffectiveAmbientGain(): number {
    if (this.prefs.muted || !this.prefs.ambientEnabled) return 0;
    return this.prefs.masterVolume * this.prefs.ambientVolume * 0.11;
  }

  private applyBusGains() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.musicMasterGain) {
      this.musicMasterGain.gain.setTargetAtTime(this.getEffectiveMusicGain(), now, 0.35);
    }
    if (this.ambientMasterGain) {
      this.ambientMasterGain.gain.setTargetAtTime(this.getEffectiveAmbientGain(), now, 0.45);
    }
  }

  private ensureContext(): AudioContext | null {
    this.loadPreferences();
    if (this.prefs.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private canPlaySfx(key: string, cooldownMs = 60): boolean {
    if (this.getEffectiveSfxGain() <= 0.005) return false;
    if (this.activeSfxVoices >= this.maxSfxVoices) return false;
    const nowMs = Date.now();
    const prev = this.lastPlayedAt.get(key) ?? 0;
    if (nowMs - prev < cooldownMs) return false;
    this.lastPlayedAt.set(key, nowMs);
    return true;
  }

  private trackVoice(durationSec: number) {
    this.activeSfxVoices += 1;
    setTimeout(() => {
      this.activeSfxVoices = Math.max(0, this.activeSfxVoices - 1);
    }, Math.ceil(durationSec * 1000) + 20);
  }

  /**
   * Starts adaptive background music & ambient bed lazily on first user gesture.
   */
  unlockAndStartAtmosphere() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.startMusicLoop(ctx);
    this.startAmbientLoop(ctx);
    this.applyBusGains();
  }

  private startMusicLoop(ctx: AudioContext) {
    if (this.musicStarted) return;
    this.musicStarted = true;
    const master = ctx.createGain();
    master.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 720;

    filter.connect(master);
    master.connect(ctx.destination);
    this.musicMasterGain = master;

    const chord = MUSIC_CHORDS[this.currentMusicState];
    const now = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(chord[i % chord.length], now);
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = i === 0 ? 0.35 : 0.22;
      osc.connect(voiceGain);
      voiceGain.connect(filter);
      osc.start(now);
      this.musicOscs.push(osc);
    }
    master.gain.setTargetAtTime(this.getEffectiveMusicGain(), now, 1.5);
  }

  private startAmbientLoop(ctx: AudioContext) {
    if (this.ambientStarted) return;
    this.ambientStarted = true;

    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Soft pink-ish noise
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.95 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2) * 0.25;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = this.getAmbientFilterFreq(this.currentAmbient);
    filter.Q.value = 0.85;

    const master = ctx.createGain();
    master.gain.value = 0;

    src.connect(filter);
    filter.connect(master);
    master.connect(ctx.destination);
    src.start(ctx.currentTime);

    this.ambientNoiseSource = src;
    this.ambientFilter = filter;
    this.ambientMasterGain = master;
    master.gain.setTargetAtTime(this.getEffectiveAmbientGain(), ctx.currentTime, 1.2);
  }

  private getAmbientFilterFreq(biome: AmbientBiome): number {
    switch (biome) {
      case 'forest':
        return 620;
      case 'water':
      case 'port':
        return 420;
      case 'city':
        return 510;
      case 'mining':
        return 260;
      case 'rain':
        return 1150;
      case 'storm':
        return 820;
      case 'night':
        return 320;
    }
  }

  setMusicState(nextState: MusicState, forceImmediate = false) {
    if (nextState === this.currentMusicState) return;
    const nowMs = Date.now();
    const isUrgent = nextState === 'war' || nextState === 'crisis';
    if (!forceImmediate && !isUrgent && nowMs - this.lastMusicSwitchMs < this.musicHoldMs) {
      return;
    }
    this.currentMusicState = nextState;
    this.lastMusicSwitchMs = nowMs;

    if (!this.ctx || !this.musicStarted || this.musicOscs.length === 0) return;
    const now = this.ctx.currentTime;
    const chord = MUSIC_CHORDS[nextState];
    this.musicOscs.forEach((osc, idx) => {
      osc.frequency.setTargetAtTime(chord[idx % chord.length], now, 1.6);
    });
  }

  getMusicState(): MusicState {
    return this.currentMusicState;
  }

  setAmbientBiome(biome: AmbientBiome) {
    if (biome === this.currentAmbient) return;
    this.currentAmbient = biome;
    if (!this.ctx || !this.ambientFilter) return;
    this.ambientFilter.frequency.setTargetAtTime(
      this.getAmbientFilterFreq(biome),
      this.ctx.currentTime,
      0.9
    );
  }

  getAmbientBiome(): AmbientBiome {
    return this.currentAmbient;
  }

  private playTone(params: {
    freqStart: number;
    freqEnd?: number;
    duration: number;
    type?: OscillatorType;
    peakGain: number;
    delay?: number;
    lowpass?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const sfxVol = this.getEffectiveSfxGain();
    if (sfxVol <= 0.005) return;

    const start = ctx.currentTime + (params.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = params.type ?? 'triangle';
    osc.frequency.setValueAtTime(params.freqStart, start);
    if (params.freqEnd && params.freqEnd !== params.freqStart) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, params.freqEnd),
        start + params.duration
      );
    }

    const scaledPeak = Math.max(0.002, params.peakGain * sfxVol);
    gain.gain.setValueAtTime(0.0008, start);
    gain.gain.linearRampToValueAtTime(scaledPeak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0008, start + params.duration);

    if (params.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(params.lowpass, start);
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + params.duration + 0.015);
    this.trackVoice(params.duration + (params.delay ?? 0));
  }

  // --- SFX API ---

  playUiClick() {
    if (!this.canPlaySfx('ui', 45)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 520, freqEnd: 590, duration: 0.04, type: 'sine', peakGain: 0.05 });
  }

  playPlace() {
    if (!this.canPlaySfx('place', 65)) return;
    if (!this.ensureContext()) return;
    const jitter = 0.94 + Math.random() * 0.12;
    this.playTone({
      freqStart: 195 * jitter,
      freqEnd: 92 * jitter,
      duration: 0.11,
      type: 'triangle',
      peakGain: 0.16,
    });
  }

  playBuildStart() {
    this.playPlace();
  }

  playBuildComplete() {
    if (!this.canPlaySfx('build_complete', 140)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 392, duration: 0.12, type: 'triangle', peakGain: 0.09, delay: 0 });
    this.playTone({ freqStart: 523.25, duration: 0.18, type: 'triangle', peakGain: 0.1, delay: 0.065 });
  }

  playUpgrade() {
    if (!this.canPlaySfx('upgrade', 120)) return;
    if (!this.ensureContext()) return;
    [349.23, 440, 587.33].forEach((freq, i) => {
      this.playTone({ freqStart: freq, duration: 0.16, type: 'triangle', peakGain: 0.09, delay: i * 0.055 });
    });
  }

  playModuleInstall() {
    if (!this.canPlaySfx('module', 120)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 440, duration: 0.08, type: 'sine', peakGain: 0.08, delay: 0 });
    this.playTone({ freqStart: 659.25, duration: 0.14, type: 'triangle', peakGain: 0.09, delay: 0.055 });
  }

  playDemolish() {
    if (!this.canPlaySfx('demolish', 90)) return;
    if (!this.ensureContext()) return;
    this.playTone({
      freqStart: 140,
      freqEnd: 52,
      duration: 0.12,
      type: 'sawtooth',
      peakGain: 0.11,
      lowpass: 420,
    });
  }

  playRotate() {
    if (!this.canPlaySfx('rotate', 45)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 520, freqEnd: 680, duration: 0.05, type: 'sine', peakGain: 0.07 });
  }

  playCycle() {
    if (!this.canPlaySfx('cycle', 45)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 420, freqEnd: 470, duration: 0.04, type: 'sine', peakGain: 0.05 });
  }

  playSaveChime() {
    if (!this.canPlaySfx('save', 150)) return;
    if (!this.ensureContext()) return;
    [523.25, 659.25].forEach((freq, idx) => {
      this.playTone({
        freqStart: freq,
        duration: 0.18,
        type: 'triangle',
        peakGain: 0.09,
        delay: idx * 0.075,
      });
    });
  }

  playConquest() {
    if (!this.canPlaySfx('conquest', 150)) return;
    if (!this.ensureContext()) return;
    [392.0, 523.25, 659.25].forEach((freq, idx) => {
      this.playTone({
        freqStart: freq,
        duration: 0.24,
        type: 'triangle',
        peakGain: 0.11,
        delay: idx * 0.065,
      });
    });
  }

  playDiscovery() {
    if (!this.canPlaySfx('discovery', 180)) return;
    if (!this.ensureContext()) return;
    [440, 554.37, 659.25, 880].forEach((freq, idx) => {
      this.playTone({
        freqStart: freq,
        duration: 0.22,
        type: 'sine',
        peakGain: 0.085,
        delay: idx * 0.06,
      });
    });
  }

  playTrade() {
    if (!this.canPlaySfx('trade', 100)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 880, duration: 0.07, type: 'sine', peakGain: 0.07, delay: 0 });
    this.playTone({ freqStart: 1174.66, duration: 0.12, type: 'sine', peakGain: 0.075, delay: 0.055 });
  }

  playDecision() {
    if (!this.canPlaySfx('decision', 200)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 293.66, duration: 0.28, type: 'triangle', peakGain: 0.1, delay: 0 });
    this.playTone({ freqStart: 440.0, duration: 0.34, type: 'sine', peakGain: 0.08, delay: 0.09 });
  }

  playDiplomacy() {
    if (!this.canPlaySfx('diplomacy', 160)) return;
    if (!this.ensureContext()) return;
    [329.63, 440, 523.25].forEach((freq, idx) => {
      this.playTone({ freqStart: freq, duration: 0.2, type: 'triangle', peakGain: 0.08, delay: idx * 0.07 });
    });
  }

  playSpecialEvent() {
    if (!this.canPlaySfx('special_event', 200)) return;
    if (!this.ensureContext()) return;
    [392, 466.16, 587.33].forEach((freq, idx) => {
      this.playTone({ freqStart: freq, duration: 0.24, type: 'triangle', peakGain: 0.09, delay: idx * 0.075 });
    });
  }

  playTurnAdvance() {
    if (!this.canPlaySfx('turn', 120)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 330, freqEnd: 440, duration: 0.09, type: 'sine', peakGain: 0.065 });
  }

  playSeasonChange() {
    if (!this.canPlaySfx('season', 250)) return;
    if (!this.ensureContext()) return;
    [392, 493.88, 587.33].forEach((freq, idx) => {
      this.playTone({ freqStart: freq, duration: 0.26, type: 'sine', peakGain: 0.06, delay: idx * 0.09 });
    });
  }

  playVictory() {
    if (!this.canPlaySfx('victory', 500)) return;
    if (!this.ensureContext()) return;
    [261.63, 329.63, 392.0, 523.25, 659.25].forEach((freq, idx) => {
      this.playTone({ freqStart: freq, duration: 0.4, type: 'triangle', peakGain: 0.11, delay: idx * 0.09 });
    });
  }

  playDefeat() {
    if (!this.canPlaySfx('defeat', 500)) return;
    if (!this.ensureContext()) return;
    [293.66, 261.63, 220.0, 174.61].forEach((freq, idx) => {
      this.playTone({ freqStart: freq, duration: 0.36, type: 'triangle', peakGain: 0.1, delay: idx * 0.13 });
    });
  }

  playError() {
    if (!this.canPlaySfx('error', 80)) return;
    if (!this.ensureContext()) return;
    this.playTone({ freqStart: 210, freqEnd: 145, duration: 0.12, type: 'sine', peakGain: 0.09 });
  }
}

export const gameAudio = new HexGameAudio();
