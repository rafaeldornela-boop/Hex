export type DeviceQualityTier =
  | 'desktop-high'
  | 'mobile-balanced'
  | 'mobile-low'
  | 'software';

export interface DeviceCapabilitiesInput {
  isSoftwareGl: boolean;
  isCoarsePointer: boolean;
  viewportWidth: number;
  devicePixelRatio: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export interface RenderQualityProfile {
  tier: DeviceQualityTier;
  pixelRatio: number;
  antialias: boolean;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  waterTextureSize: number;
  particlePoolSize: number;
  gridGuideRings: number;
  idleFrameIntervalMs: number;
}

export function resolveRenderQualityProfile(
  input: DeviceCapabilitiesInput
): RenderQualityProfile {
  if (input.isSoftwareGl) {
    return {
      tier: 'software',
      pixelRatio: 1,
      antialias: false,
      shadowsEnabled: false,
      shadowMapSize: 512,
      waterTextureSize: 256,
      particlePoolSize: 24,
      gridGuideRings: 7,
      idleFrameIntervalMs: 80,
    };
  }

  const isMobileFormFactor =
    input.isCoarsePointer || input.viewportWidth < 820;

  if (!isMobileFormFactor) {
    return {
      tier: 'desktop-high',
      pixelRatio: Math.min(Math.max(input.devicePixelRatio || 1, 1), 2),
      antialias: true,
      shadowsEnabled: true,
      shadowMapSize: 1024,
      waterTextureSize: 512,
      particlePoolSize: 48,
      gridGuideRings: 7,
      idleFrameIntervalMs: 0,
    };
  }

  const cores = input.hardwareConcurrency ?? 6;
  const memoryGb = input.deviceMemory ?? 4;
  const isLowEndMobile = cores <= 4 || memoryGb <= 3;

  if (isLowEndMobile) {
    return {
      tier: 'mobile-low',
      pixelRatio: 1,
      antialias: false,
      shadowsEnabled: false,
      shadowMapSize: 512,
      waterTextureSize: 256,
      particlePoolSize: 18,
      gridGuideRings: 5,
      idleFrameIntervalMs: 55,
    };
  }

  return {
    tier: 'mobile-balanced',
    pixelRatio: Math.min(Math.max(input.devicePixelRatio || 1, 1), 1.5),
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 512,
    waterTextureSize: 256,
    particlePoolSize: 28,
    gridGuideRings: 6,
    idleFrameIntervalMs: 40,
  };
}

export function detectDeviceQualityProfile(
  isSoftwareGl: boolean
): RenderQualityProfile {
  if (typeof window === 'undefined') {
    return resolveRenderQualityProfile({
      isSoftwareGl: true,
      isCoarsePointer: false,
      viewportWidth: 1280,
      devicePixelRatio: 1,
    });
  }

  const isCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const nav = navigator as Navigator & { deviceMemory?: number };

  return resolveRenderQualityProfile({
    isSoftwareGl,
    isCoarsePointer,
    viewportWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
  });
}
