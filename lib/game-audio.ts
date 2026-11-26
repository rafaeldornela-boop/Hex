/**
 * Centralized audio engine for Hexagon World (Hex).
 * Plays original medieval/historical strategy instrumental MP3 tracks,
 * natural ambient soundscapes, and acoustic SFX with smooth crossfades,
 * lazy on-demand loading, mobile autoplay-safe unlocking, and persisted
 * volume & accessibility preferences.
 */
import { withBasePath } from './base-path';

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

export type SfxAssetKey =
  | 'build'
  | 'build_complete'
  | 'demolish'
  | 'research'
  | 'trade'
  | 'combat'
  | 'conquest'
  | 'discovery'
  | 'event'
  | 'victory'
  | 'defeat';

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

export const MUSIC_TRACK_PATHS: Record<MusicState, string> = {
  normal: '/audio/music/normal.mp3',
  prosperity: '/audio/music/prosperity.mp3',
  crisis: '/audio/music/crisis.mp3',
  war: '/audio/music/war.mp3',
  discovery: '/audio/music/discovery.mp3',
};

export const AMBIENT_TRACK_PATHS: Record<AmbientBiome, string> = {
  forest: '/audio/ambient/forest.mp3',
  water: '/audio/ambient/water.mp3',
  city: '/audio/ambient/city.mp3',
  mining: '/audio/ambient/mining.mp3',
  port: '/audio/ambient/port.mp3',
  rain: '/audio/ambient/rain.mp3',
  storm: '/audio/ambient/storm.mp3',
  night: '/audio/ambient/night.mp3',
};

export const SFX_ASSET_PATHS: Record<SfxAssetKey, string> = {
  build: '/audio/sfx/build.mp3',
  build_complete: '/audio/sfx/build_complete.mp3',
  demolish: '/audio/sfx/demolish.mp3',
  research: '/audio/sfx/research.mp3',
  trade: '/audio/sfx/trade.mp3',
  combat: '/audio/sfx/combat.mp3',
  conquest: '/audio/sfx/conquest.mp3',
  discovery: '/audio/sfx/discovery.mp3',
  event: '/audio/sfx/event.mp3',
  victory: '/audio/sfx/victory.mp3',
  defeat: '/audio/sfx/defeat.mp3',
};

export const DEFAULT_AUDIO_PREFERENCES: GameAudioPreferences = {
  masterVolume: 0.78,
  musicVolume: 0.52,
  sfxVolume: 0.82,
  ambientVolume: 0.34,
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

interface CrossfadeChannel {
  activeEl: HTMLAudioElement | null;
  fadingOutEl: HTMLAudioElement | null;
  activeKey: string | null;
  fadeTimer: ReturnType<typeof setInterval> | null;
}

class HexGameAudio {
  private ctx: AudioContext | null = null;
  private prefs: GameAudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  private prefsLoaded = false;
  private unlocked = false;
  private listeners = new Set<(prefs: GameAudioPreferences) => void>();

  // Rate-limiting & polyphony caps
  private lastPlayedAt = new Map<string, number>();
  private activeSfxVoices = 0;
  private readonly maxSfxVoices = 8;

  // Lazy-decoded acoustic SFX buffer cache
  private sfxBuffers = new Map<SfxAssetKey, AudioBuffer>();
  private sfxLoading = new Map<SfxAssetKey, Promise<AudioBuffer | null>>();

  // HTMLAudioElement streaming channels for music & ambient (mobile-friendly, low RAM)
  private musicChannel: CrossfadeChannel = {
    activeEl: null,
    fadingOutEl: null,
    activeKey: null,
    fadeTimer: null,
  };
  private ambientChannel: CrossfadeChannel = {
    activeEl: null,
    fadingOutEl: null,
    activeKey: null,
    fadeTimer: null,
  };

  private currentMusicState: MusicState = 'normal';
  private lastMusicSwitchMs = 0;
  private readonly musicHoldMs = 18000;
  private currentAmbient: AmbientBiome = 'forest';

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
    this.applyBusVolumes();
    for (const cb of this.listeners) {
      cb({ ...this.prefs });
    }
    return { ...this.prefs };
  }

  resetPreferences(): GameAudioPreferences {
    this.prefs = { ...DEFAULT_AUDIO_PREFERENCES };
    this.savePreferences();
    this.applyBusVolumes();
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
    return clamp01(this.prefs.masterVolume * this.prefs.musicVolume * 0.72, 0);
  }

  private getEffectiveAmbientGain(): number {
    if (this.prefs.muted || !this.prefs.ambientEnabled) return 0;
    return clamp01(this.prefs.masterVolume * this.prefs.ambientVolume * 0.42, 0);
  }

  private applyBusVolumes() {
    const musicVol = this.getEffectiveMusicGain();
    if (this.musicChannel.activeEl) {
      this.musicChannel.activeEl.volume = musicVol;
      if (musicVol <= 0.002 && !this.musicChannel.activeEl.paused) {
        this.musicChannel.activeEl.pause();
      } else if (musicVol > 0.002 && this.unlocked && this.musicChannel.activeEl.paused) {
        this.musicChannel.activeEl.play().catch(() => {});
      }
    }

    const ambVol = this.getEffectiveAmbientGain();
    if (this.ambientChannel.activeEl) {
      this.ambientChannel.activeEl.volume = ambVol;
      if (ambVol <= 0.002 && !this.ambientChannel.activeEl.paused) {
        this.ambientChannel.activeEl.pause();
      } else if (ambVol > 0.002 && this.unlocked && this.ambientChannel.activeEl.paused) {
        this.ambientChannel.activeEl.play().catch(() => {});
      }
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

  private createLoopElement(srcPath: string): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    const el = new Audio(withBasePath(srcPath));
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    el.setAttribute('playsinline', '');
    return el;
  }

  private crossfadeChannel(
    channel: CrossfadeChannel,
    key: string,
    srcPath: string,
    getTargetVol: () => number,
    fadeDurationMs = 1800
  ) {
    if (!this.unlocked || typeof window === 'undefined') return;
    if (channel.activeKey === key && channel.activeEl) {
      const target = getTargetVol();
      if (target > 0.002 && channel.activeEl.paused) {
        channel.activeEl.volume = target;
        channel.activeEl.play().catch(() => {});
      }
      return;
    }

    if (channel.fadeTimer) {
      clearInterval(channel.fadeTimer);
      channel.fadeTimer = null;
    }
    if (channel.fadingOutEl) {
      channel.fadingOutEl.pause();
      channel.fadingOutEl.src = '';
      channel.fadingOutEl = null;
    }

    const outgoing = channel.activeEl;
    const incoming = this.createLoopElement(srcPath);
    if (!incoming) return;

    channel.fadingOutEl = outgoing;
    channel.activeEl = incoming;
    channel.activeKey = key;

    const targetVol = getTargetVol();
    if (targetVol > 0.002) {
      incoming.play().catch(() => {});
    }

    const startOutVol = outgoing ? outgoing.volume : 0;
    const steps = Math.max(8, Math.round(fadeDurationMs / 75));
    let step = 0;

    channel.fadeTimer = setInterval(() => {
      step += 1;
      const t = Math.min(1, step / steps);
      const currentTarget = getTargetVol();
      if (channel.activeEl === incoming) {
        incoming.volume = clamp01(currentTarget * t, 0);
      }
      if (outgoing) {
        outgoing.volume = clamp01(startOutVol * (1 - t), 0);
      }
      if (t >= 1) {
        if (channel.fadeTimer) {
          clearInterval(channel.fadeTimer);
          channel.fadeTimer = null;
        }
        if (outgoing) {
          outgoing.pause();
          outgoing.src = '';
          if (channel.fadingOutEl === outgoing) {
            channel.fadingOutEl = null;
          }
        }
      }
    }, 75);
  }

  /**
   * Unlocks Web Audio & HTML5 audio streams on first user interaction (mobile-safe).
   */
  unlockAndStartAtmosphere() {
    this.loadPreferences();
    this.unlocked = true;
    this.ensureContext();
    this.crossfadeChannel(
      this.musicChannel,
      this.currentMusicState,
      MUSIC_TRACK_PATHS[this.currentMusicState],
      () => this.getEffectiveMusicGain(),
      2000
    );
    this.crossfadeChannel(
      this.ambientChannel,
      this.currentAmbient,
      AMBIENT_TRACK_PATHS[this.currentAmbient],
      () => this.getEffectiveAmbientGain(),
      1400
    );
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

    if (this.unlocked) {
      this.crossfadeChannel(
        this.musicChannel,
        nextState,
        MUSIC_TRACK_PATHS[nextState],
        () => this.getEffectiveMusicGain(),
        2200
      );
    }
  }

  getMusicState(): MusicState {
    return this.currentMusicState;
  }

  setAmbientBiome(biome: AmbientBiome) {
    if (biome === this.currentAmbient) return;
    this.currentAmbient = biome;
    if (this.unlocked) {
      this.crossfadeChannel(
        this.ambientChannel,
        biome,
        AMBIENT_TRACK_PATHS[biome],
        () => this.getEffectiveAmbientGain(),
        1400
      );
    }
  }

  getAmbientBiome(): AmbientBiome {
    return this.currentAmbient;
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
    }, Math.ceil(durationSec * 1000) + 25);
  }

  private loadSfxBuffer(key: SfxAssetKey): Promise<AudioBuffer | null> {
    const cached = this.sfxBuffers.get(key);
    if (cached) return Promise.resolve(cached);
    const inflight = this.sfxLoading.get(key);
    if (inflight) return inflight;

    const ctx = this.ensureContext();
    if (!ctx || typeof fetch === 'undefined') return Promise.resolve(null);

    const p = fetch(withBasePath(SFX_ASSET_PATHS[key]))
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((buf) => (buf ? ctx.decodeAudioData(buf) : null))
      .then((decoded) => {
        if (decoded) this.sfxBuffers.set(key, decoded);
        this.sfxLoading.delete(key);
        return decoded;
      })
      .catch(() => {
        this.sfxLoading.delete(key);
        return null;
      });
    this.sfxLoading.set(key, p);
    return p;
  }

  private playSfxBuffer(key: SfxAssetKey, gainScale = 0.72, cooldownMs = 90) {
    if (!this.canPlaySfx(`buf:${key}`, cooldownMs)) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const trigger = (buffer: AudioBuffer | null) => {
      if (!buffer || !this.ctx || this.prefs.muted) return;
      const vol = clamp01(this.getEffectiveSfxGain() * gainScale, 0);
      if (vol <= 0.004) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = this.ctx.createGain();
      gain.gain.value = vol;
      src.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(0);
      this.trackVoice(Math.min(buffer.duration, 3.5));
    };

    const cached = this.sfxBuffers.get(key);
    if (cached) {
      trigger(cached);
    } else {
      void this.loadSfxBuffer(key).then(trigger);
    }
  }

  private playSubtleUiTone(freqStart: number, freqEnd: number, duration: number, peakGain: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const sfxVol = this.getEffectiveSfxGain();
    if (sfxVol <= 0.005) return;

    const start = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqStart, start);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), start + duration);
    }
    const scaled = Math.max(0.002, peakGain * sfxVol);
    gain.gain.setValueAtTime(0.0008, start);
    gain.gain.linearRampToValueAtTime(scaled, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0008, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.015);
    this.trackVoice(duration);
  }

  // --- SFX Public API ---

  playUiClick() {
    if (!this.canPlaySfx('ui', 45)) return;
    if (!this.ensureContext()) return;
    this.playSubtleUiTone(540, 610, 0.038, 0.045);
  }

  playPlace() {
    this.playSfxBuffer('build', 0.78, 70);
  }

  playBuildStart() {
    this.playSfxBuffer('build', 0.78, 70);
  }

  playBuildComplete() {
    this.playSfxBuffer('build_complete', 0.78, 160);
  }

  playUpgrade() {
    this.playSfxBuffer('build_complete', 0.82, 160);
  }

  playModuleInstall() {
    this.playSfxBuffer('build_complete', 0.72, 150);
  }

  playDemolish() {
    this.playSfxBuffer('demolish', 0.78, 100);
  }

  playRotate() {
    if (!this.canPlaySfx('rotate', 45)) return;
    if (!this.ensureContext()) return;
    this.playSubtleUiTone(480, 620, 0.045, 0.05);
  }

  playCycle() {
    if (!this.canPlaySfx('cycle', 45)) return;
    if (!this.ensureContext()) return;
    this.playSubtleUiTone(410, 460, 0.036, 0.042);
  }

  playSaveChime() {
    this.playSfxBuffer('trade', 0.62, 160);
  }

  playResearchComplete() {
    this.playSfxBuffer('research', 0.85, 220);
  }

  playCombat() {
    this.playSfxBuffer('combat', 0.82, 120);
  }

  playConquest() {
    this.playSfxBuffer('conquest', 0.84, 220);
  }

  playDiscovery() {
    this.playSfxBuffer('discovery', 0.82, 220);
  }

  playTrade() {
    this.playSfxBuffer('trade', 0.76, 110);
  }

  playDecision() {
    this.playSfxBuffer('event', 0.78, 240);
  }

  playDiplomacy() {
    this.playSfxBuffer('event', 0.7, 180);
  }

  playSpecialEvent() {
    this.playSfxBuffer('discovery', 0.72, 220);
  }

  playTurnAdvance() {
    if (!this.canPlaySfx('turn', 120)) return;
    if (!this.ensureContext()) return;
    this.playSubtleUiTone(330, 415, 0.075, 0.052);
  }

  playSeasonChange() {
    this.playSfxBuffer('discovery', 0.56, 300);
  }

  playVictory() {
    this.playSfxBuffer('victory', 0.9, 600);
  }

  playDefeat() {
    this.playSfxBuffer('defeat', 0.88, 600);
  }

  playError() {
    if (!this.canPlaySfx('error', 90)) return;
    if (!this.ensureContext()) return;
    this.playSubtleUiTone(215, 150, 0.11, 0.075);
  }
}

export const gameAudio = new HexGameAudio();
