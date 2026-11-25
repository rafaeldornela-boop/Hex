import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import { hexKey, type AxialCoord, type HexOwner, type HexWorldState } from './hex-engine';
import {
  evaluateRegionalWorld,
  getSpecializationStage,
  REGIONAL_SPECIALIZATION_CATALOG,
  SPECIALIZATION_STAGE_META,
  type NaturalDistrict,
  type RegionalSpecializationBadge,
  type RegionalSpecializationId,
  type RegionalWorldSummary,
} from './regional-engine';
import {
  computeRoadConnectivity,
  type RoadConnectivitySummary,
  type RoadMap,
} from './road-engine';
import type { TechId } from './tech-engine';
import { axialDistance } from './territory-engine';

export type CityStage = 1 | 2 | 3 | 4 | 5;

export interface CityEntity {
  id: string;
  name: string;
  center: AxialCoord;
  owner: HexOwner;
  foundedTurn: number;
  level: CityStage;
  stageLabelPt: string;
  developmentScore: number;
  nextLevelScore: number | null;
  localPopulation: number;
  primarySpecialization?: RegionalSpecializationBadge | null;
  specializations: RegionalSpecializationBadge[];
  districts: NaturalDistrict[];
  regionHexKeys?: string[];
  connectedCityIds: string[];
  networkId: string | null;
  stabilityLabelPt: string;
  growthBonusPct: number;
}

export const CITY_STAGE_META: Record<
  CityStage,
  { labelPt: string; minScore: number; nextScore: number | null; capacityBonus: number }
> = {
  1: { labelPt: 'Acampamento', minScore: 0, nextScore: 18, capacityBonus: 0 },
  2: { labelPt: 'Aldeia', minScore: 18, nextScore: 42, capacityBonus: 0 },
  3: { labelPt: 'Vila', minScore: 42, nextScore: 68, capacityBonus: 1 },
  4: { labelPt: 'Cidade', minScore: 68, nextScore: 96, capacityBonus: 2 },
  5: { labelPt: 'Grande Cidade', minScore: 96, nextScore: null, capacityBonus: 3 },
};

export const CITY_FOUNDING_ASSETS = new Set<string>([
  'building-village',
  'unit-mansion',
  'building-castle',
]);

export const MIN_CITY_SEPARATION = 3;

const CITY_NAME_POOL: readonly string[] = [
  'Boa Vista',
  'Santa Clara',
  'São Miguel',
  'Nova Esperança',
  'Vila Verde',
  'Serra Alta',
  'Rio Claro',
  'Porto Real',
  'Monte Belo',
  'Vale Dourado',
  'Pedra Branca',
  'Campo Largo',
  'Nova Aurora',
  'Pinheiros',
  'Ouro Preto',
  'Costa Azul',
  'Águas Claras',
  'Vista Alegre',
  'Terra Nova',
  'Lago Dourado',
  'Sol Nascente',
  'Vila Rica',
  'Alto da Serra',
  'Bom Retiro',
];

export function pickNextUniqueCityName(
  usedNames: Iterable<string>,
  seed: number,
  coord: AxialCoord
): string {
  const taken = new Set(Array.from(usedNames).map((n) => n.trim().toLowerCase()));
  const startIdx = Math.abs(seed + coord.q * 17 + coord.r * 31) % CITY_NAME_POOL.length;
  for (let offset = 0; offset < CITY_NAME_POOL.length; offset++) {
    const candidate = CITY_NAME_POOL[(startIdx + offset) % CITY_NAME_POOL.length];
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  let suffix = 2;
  while (taken.has(`nova vila ${suffix}`)) {
    suffix++;
  }
  return `Nova Vila ${suffix}`;
}

export function getCityStageForScore(score: number): CityStage {
  if (score >= 96) return 5;
  if (score >= 68) return 4;
  if (score >= 42) return 3;
  if (score >= 18) return 2;
  return 1;
}

export function ensureStarterCapitalCity(params: {
  playerCapital?: AxialCoord;
  worldState: HexWorldState;
  worldSeed?: number;
  existingCities?: CityEntity[];
}): CityEntity[] {
  const { playerCapital, worldState, worldSeed = 42026, existingCities = [] } = params;
  const cleaned = existingCities.filter((c) => {
    const tile = worldState.hexes[hexKey(c.center.q, c.center.r)];
    return tile && tile.owner === c.owner;
  });

  if (cleaned.some((c) => c.owner === 'player')) {
    return cleaned;
  }

  let cap = playerCapital;
  if (!cap || worldState.hexes[hexKey(cap.q, cap.r)]?.owner !== 'player') {
    const firstPlayer = Object.values(worldState.hexes).find((t) => t.owner === 'player');
    if (firstPlayer) {
      cap = { q: firstPlayer.q, r: firstPlayer.r };
    }
  }
  if (!cap) return cleaned;

  const name = pickNextUniqueCityName(
    cleaned.map((c) => c.name),
    worldSeed,
    cap
  );

  return [
    ...cleaned,
    {
      id: `city-${cap.q}-${cap.r}`,
      name,
      center: { q: cap.q, r: cap.r },
      owner: 'player',
      foundedTurn: 1,
      level: 2,
      stageLabelPt: CITY_STAGE_META[2].labelPt,
      developmentScore: 22,
      nextLevelScore: CITY_STAGE_META[2].nextScore,
      localPopulation: 18,
      specializations: [],
      districts: [],
      connectedCityIds: [],
      networkId: null,
      stabilityLabelPt: 'Estável',
      growthBonusPct: 0,
    },
  ];
}

export function syncAndEvolveCities(params: {
  worldState: HexWorldState;
  roads: RoadMap;
  existingCities: CityEntity[];
  playerCapital?: AxialCoord;
  population: number;
  unlockedTechs: TechId[];
  assets: HexAssetEntry[];
  underConstructionKeys?: Set<string>;
  hasFoodDeficit?: boolean;
  turn: number;
  worldSeed?: number;
}): {
  cities: CityEntity[];
  connectivity: RoadConnectivitySummary;
  regional: RegionalWorldSummary;
  newlyFoundedCities: CityEntity[];
  leveledUpCities: Array<{ city: CityEntity; fromLevel: CityStage; toLevel: CityStage }>;
} {
  const {
    worldState,
    roads,
    existingCities,
    playerCapital,
    population,
    unlockedTechs,
    assets,
    underConstructionKeys,
    hasFoodDeficit = false,
    turn,
    worldSeed = 42026,
  } = params;

  const workingCities = ensureStarterCapitalCity({
    playerCapital,
    worldState,
    worldSeed,
    existingCities,
  }).map((c) => ({ ...c }));

  const newlyFoundedCities: CityEntity[] = [];
  const usedNames = workingCities.map((c) => c.name);

  // Discover newly completed founding buildings (Vila, Mansão, Castelo) at dist >= 3 from existing cities
  const candidateFounders = Object.values(worldState.hexes)
    .filter((tile) => {
      if (tile.owner !== 'player') return false;
      const key = hexKey(tile.q, tile.r);
      if (underConstructionKeys?.has(key)) return false;
      const assetName = assets[tile.structureIndex]?.name ?? '';
      return CITY_FOUNDING_ASSETS.has(assetName);
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);

  for (const tile of candidateFounders) {
    const tooClose = workingCities.some(
      (c) => axialDistance(c.center, tile) < MIN_CITY_SEPARATION
    );
    if (tooClose) continue;

    const name = pickNextUniqueCityName(usedNames, worldSeed, tile);
    usedNames.push(name);
    const founded: CityEntity = {
      id: `city-${tile.q}-${tile.r}`,
      name,
      center: { q: tile.q, r: tile.r },
      owner: 'player',
      foundedTurn: turn,
      level: 1,
      stageLabelPt: CITY_STAGE_META[1].labelPt,
      developmentScore: 10,
      nextLevelScore: CITY_STAGE_META[1].nextScore,
      localPopulation: 6,
      specializations: [],
      districts: [],
      connectedCityIds: [],
      networkId: null,
      stabilityLabelPt: 'Recém-fundada',
      growthBonusPct: 0,
    };
    workingCities.push(founded);
    newlyFoundedCities.push(founded);
  }

  const connectivity = computeRoadConnectivity({
    worldState,
    roads,
    cityCenters: workingCities.map((c) => ({
      id: c.id,
      center: c.center,
      level: c.level,
    })),
    assets,
    owner: 'player',
    underConstructionKeys,
  });

  const previousPrimaryByCityId: Record<string, RegionalSpecializationId> = {};
  for (const c of workingCities) {
    const prevId = c.primarySpecialization?.id ?? c.specializations?.[0]?.id;
    if (prevId) {
      previousPrimaryByCityId[c.id] = prevId;
    }
  }

  const regional = evaluateRegionalWorld({
    worldState,
    cities: workingCities.map((c) => ({
      id: c.id,
      name: c.name,
      center: c.center,
      owner: c.owner,
      level: c.level,
    })),
    roads,
    connectivity,
    assets,
    underConstructionKeys,
    previousPrimaryByCityId,
    owner: 'player',
  });

  // Assign local population share proportionally by nearby housing capacity
  const housingWeights = workingCities.map((city) => {
    let hw = 4;
    for (const tile of Object.values(worldState.hexes)) {
      if (tile.owner !== 'player') continue;
      if (axialDistance(city.center, tile) > 2) continue;
      const key = hexKey(tile.q, tile.r);
      if (underConstructionKeys?.has(key)) continue;
      const bDef = getBuildingDefinition(assets[tile.structureIndex]?.name ?? '');
      hw += bDef.housingCapacity;
    }
    return hw;
  });
  const totalWeight = Math.max(1, housingWeights.reduce((a, b) => a + b, 0));

  const leveledUpCities: Array<{
    city: CityEntity;
    fromLevel: CityStage;
    toLevel: CityStage;
  }> = [];

  const updatedCities = workingCities.map((city, idx) => {
    const centerKey = hexKey(city.center.q, city.center.r);
    const centerMetric = connectivity.tileMetricsByKey[centerKey];
    const connectedCityIds = (centerMetric?.connectedCityIds ?? [city.id]).filter(
      (id) => id !== city.id
    );
    const networkId = centerMetric?.networkId ?? null;

    const regionalProfile = regional.cityProfilesById[city.id];
    const districts = regionalProfile?.districts ?? [];
    const specializations = regionalProfile?.specializations ?? [];
    const primarySpecialization =
      regionalProfile?.primarySpecialization ?? specializations[0] ?? null;
    const regionHexKeys = regional.regionHexKeysByCityId[city.id] ?? [];

    let completedNear = 0;
    let housingNear = 0;
    let roadsNear = 0;
    let commerceNear = 0;
    for (const tile of Object.values(worldState.hexes)) {
      if (tile.owner !== 'player') continue;
      const d = axialDistance(city.center, tile);
      if (d > 2) continue;
      const key = hexKey(tile.q, tile.r);
      const road = roads[key];
      if (road) roadsNear += 1 + (road.level >= 3 ? 0.6 : 0);
      if (underConstructionKeys?.has(key)) continue;
      const assetName = assets[tile.structureIndex]?.name ?? '';
      const bDef = getBuildingDefinition(assetName);
      if (bDef.housingCapacity > 0) housingNear += bDef.housingCapacity;
      if (bDef.role === 'commerce') commerceNear += 1;
      if (
        bDef.housingCapacity > 0 ||
        bDef.workersRequired > 0 ||
        bDef.defenseBonus > 0 ||
        bDef.role === 'capital'
      ) {
        completedNear += 1;
      }
    }

    const localPopulation = Math.max(
      1,
      Math.round((population * housingWeights[idx]) / totalWeight)
    );

    const rawScore =
      completedNear * 2.5 +
      housingNear * 0.35 +
      roadsNear * 2.2 +
      Math.min(24, connectedCityIds.length * 10) +
      districts.length * 5 +
      commerceNear * 3 +
      unlockedTechs.length * 3 +
      (hasFoodDeficit ? -8 : 4);

    const developmentScore = Math.max(0, Math.round(rawScore));
    const computedStage = getCityStageForScore(developmentScore);
    const prevStage = city.level;
    const nextStage = Math.max(prevStage, computedStage) as CityStage;

    if (nextStage > prevStage) {
      leveledUpCities.push({
        city: { ...city, level: nextStage },
        fromLevel: prevStage,
        toLevel: nextStage,
      });
    }

    const stageMeta = CITY_STAGE_META[nextStage];
    const stabilityLabelPt = hasFoodDeficit
      ? 'Escassez de Alimento'
      : connectedCityIds.length > 0
        ? 'Rede Próspera'
        : roadsNear >= 2
          ? 'Conectada'
          : 'Estável';

    const growthBonusPct =
      (nextStage - 1) * 4 +
      Math.min(10, connectedCityIds.length * 5) +
      (districts.length > 0 ? 4 : 0);

    return {
      ...city,
      level: nextStage,
      stageLabelPt: stageMeta.labelPt,
      developmentScore,
      nextLevelScore: stageMeta.nextScore,
      localPopulation,
      primarySpecialization,
      specializations,
      districts,
      regionHexKeys,
      connectedCityIds,
      networkId,
      stabilityLabelPt,
      growthBonusPct,
    };
  });

  return {
    cities: updatedCities,
    connectivity,
    regional,
    newlyFoundedCities,
    leveledUpCities,
  };
}

export function getCityAtCoord(
  cities: CityEntity[] | undefined,
  q: number,
  r: number
): CityEntity | null {
  if (!cities) return null;
  return cities.find((c) => c.center.q === q && c.center.r === r) ?? null;
}

export function getCityTerritoryCapacityBonus(
  cities: CityEntity[] | undefined
): number {
  if (!cities) return 0;
  return cities.reduce(
    (sum, c) => sum + (CITY_STAGE_META[c.level]?.capacityBonus ?? 0),
    0
  );
}

function normalizeSpecializationBadge(raw: unknown): RegionalSpecializationBadge | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<RegionalSpecializationBadge>;
  if (typeof s.id !== 'string' || !(s.id in REGIONAL_SPECIALIZATION_CATALOG)) {
    return null;
  }
  const id = s.id as RegionalSpecializationId;
  const meta = REGIONAL_SPECIALIZATION_CATALOG[id];
  const score = typeof s.score === 'number' && Number.isFinite(s.score) ? Math.round(s.score) : 6;
  const stage =
    s.stage && s.stage in SPECIALIZATION_STAGE_META
      ? s.stage
      : getSpecializationStage(score);
  return {
    id,
    labelPt: meta.labelPt,
    score,
    stage,
    stageLabelPt: SPECIALIZATION_STAGE_META[stage].labelPt,
    summaryPt: meta.summaryPt,
    bonusSummaryPt: meta.bonusByStagePt[stage],
  };
}

export function normalizeCities(
  raw: unknown,
  worldState: HexWorldState,
  playerCapital?: AxialCoord,
  worldSeed = 42026
): CityEntity[] {
  if (!Array.isArray(raw)) {
    return ensureStarterCapitalCity({
      playerCapital,
      worldState,
      worldSeed,
      existingCities: [],
    });
  }

  const parsed: CityEntity[] = [];
  const usedNames = new Set<string>();
  const seenCoords = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Partial<CityEntity>;
    if (
      !c.center ||
      typeof c.center.q !== 'number' ||
      typeof c.center.r !== 'number'
    ) {
      continue;
    }
    const q = Math.round(c.center.q);
    const r = Math.round(c.center.r);
    const k = hexKey(q, r);
    const tile = worldState.hexes[k];
    if (!tile || tile.owner !== 'player' || seenCoords.has(k)) continue;
    seenCoords.add(k);

    let name =
      typeof c.name === 'string' && c.name.trim().length > 0
        ? c.name.trim()
        : pickNextUniqueCityName(usedNames, worldSeed, { q, r });
    if (usedNames.has(name.toLowerCase())) {
      name = pickNextUniqueCityName(usedNames, worldSeed, { q, r });
    }
    usedNames.add(name.toLowerCase());

    const level = (
      typeof c.level === 'number'
        ? Math.max(1, Math.min(5, Math.round(c.level)))
        : 2
    ) as CityStage;

    parsed.push({
      id: typeof c.id === 'string' && c.id ? c.id : `city-${q}-${r}`,
      name,
      center: { q, r },
      owner: 'player',
      foundedTurn:
        typeof c.foundedTurn === 'number' && c.foundedTurn >= 1
          ? Math.round(c.foundedTurn)
          : 1,
      level,
      stageLabelPt: CITY_STAGE_META[level].labelPt,
      developmentScore:
        typeof c.developmentScore === 'number' ? Math.round(c.developmentScore) : 20,
      nextLevelScore: CITY_STAGE_META[level].nextScore,
      localPopulation:
        typeof c.localPopulation === 'number' ? Math.round(c.localPopulation) : 10,
      primarySpecialization: normalizeSpecializationBadge(c.primarySpecialization),
      specializations: Array.isArray(c.specializations)
        ? c.specializations
            .map((s) => normalizeSpecializationBadge(s))
            .filter((s): s is RegionalSpecializationBadge => s !== null)
        : [],
      districts: Array.isArray(c.districts) ? c.districts : [],
      regionHexKeys: Array.isArray(c.regionHexKeys)
        ? c.regionHexKeys.filter((k): k is string => typeof k === 'string')
        : [],
      connectedCityIds: Array.isArray(c.connectedCityIds) ? c.connectedCityIds : [],
      networkId: typeof c.networkId === 'string' ? c.networkId : null,
      stabilityLabelPt:
        typeof c.stabilityLabelPt === 'string' ? c.stabilityLabelPt : 'Estável',
      growthBonusPct:
        typeof c.growthBonusPct === 'number' ? Math.round(c.growthBonusPct) : 0,
    });
  }

  return ensureStarterCapitalCity({
    playerCapital,
    worldState,
    worldSeed,
    existingCities: parsed,
  });
}
