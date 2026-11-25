import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import { aggregateTileModuleEffects, getInstalledModules } from './building-modules-engine';
import { hexKey, type AxialCoord, type HexOwner, type HexWorldState } from './hex-engine';
import type { RoadConnectivitySummary, RoadMap } from './road-engine';
import { getHexTerrainAndResource } from './terrain-engine';
import { AXIAL_DIRECTIONS, axialDistance } from './territory-engine';

export type RegionalSpecializationId =
  | 'agricultural'
  | 'forestry'
  | 'mining'
  | 'urban'
  | 'commercial'
  | 'port'
  | 'academic';

export type SpecializationStage = 'developing' | 'consolidated' | 'specialized';

export interface RegionalSpecializationBadge {
  id: RegionalSpecializationId;
  labelPt: string;
  score: number;
  stage: SpecializationStage;
  stageLabelPt: string;
  summaryPt: string;
  bonusSummaryPt: string;
}

export type NaturalDistrictType =
  | 'agricultural'
  | 'mining'
  | 'forestry'
  | 'residential'
  | 'commercial'
  | 'port'
  | 'academic';

export interface NaturalDistrict {
  id: string;
  cityId: string;
  type: NaturalDistrictType;
  labelPt: string;
  hexKeys: string[];
  bonusPct: number;
  bonusGoldFlat: number;
  summaryPt: string;
}

export interface TradeCorridor {
  id: string;
  cityAId: string;
  cityAName: string;
  cityBId: string;
  cityBName: string;
  labelPt: string;
  goldBonus: number;
}

export interface RegionalHexBonus {
  districtId: string;
  districtLabelPt: string;
  districtType: NaturalDistrictType;
  multiplier: number;
  bonusGoldFlat: number;
}

export interface RegionalCityProfile {
  cityId: string;
  primarySpecialization: RegionalSpecializationBadge;
  specializations: RegionalSpecializationBadge[];
  districts: NaturalDistrict[];
  regionHexKeys: string[];
  roadConnectedTileCount: number;
  localProductionBonusPct: number;
}

export interface RegionalWorldSummary {
  cityProfilesById: Record<string, RegionalCityProfile>;
  controllingCityIdByHexKey: Record<string, string>;
  regionHexKeysByCityId: Record<string, string[]>;
  hexBonusesByKey: Record<string, RegionalHexBonus>;
  allDistricts: NaturalDistrict[];
  tradeCorridors: TradeCorridor[];
  corridorTradeGold: number;
}

export interface SpecializationCatalogEntry {
  id: RegionalSpecializationId;
  labelPt: string;
  summaryPt: string;
  bonusByStagePt: Record<SpecializationStage, string>;
}

export const HYSTERESIS_MARGIN = 4;

export const SPECIALIZATION_STAGE_META: Record<
  SpecializationStage,
  { labelPt: string; minScore: number; tier: 1 | 2 | 3 }
> = {
  developing: { labelPt: 'Em Desenvolvimento', minScore: 6, tier: 1 },
  consolidated: { labelPt: 'Consolidada', minScore: 16, tier: 2 },
  specialized: { labelPt: 'Especializada', minScore: 28, tier: 3 },
};

export function getSpecializationStage(score: number): SpecializationStage {
  if (score >= SPECIALIZATION_STAGE_META.specialized.minScore) return 'specialized';
  if (score >= SPECIALIZATION_STAGE_META.consolidated.minScore) return 'consolidated';
  return 'developing';
}

export const REGIONAL_SPECIALIZATION_CATALOG: Record<
  RegionalSpecializationId,
  SpecializationCatalogEntry
> = {
  agricultural: {
    id: 'agricultural',
    labelPt: 'Região Agrícola',
    summaryPt: 'Solos férteis, fazendas e moinhos sustentam safra e celeiros.',
    bonusByStagePt: {
      developing: '+12 cap. Alimento · +5% resiliência climática',
      consolidated: '+24 cap. Alimento · +10% resiliência climática',
      specialized: '+40 cap. Alimento · +15% resiliência climática',
    },
  },
  forestry: {
    id: 'forestry',
    labelPt: 'Região Madeireira',
    summaryPt: 'Bosques e serrarias ampliam corte de madeira e manutenção viária.',
    bonusByStagePt: {
      developing: '+6% Madeira · -1 manutenção de estradas',
      consolidated: '+10% Madeira · -2 manutenção de estradas',
      specialized: '+15% Madeira · -3 manutenção de estradas',
    },
  },
  mining: {
    id: 'mining',
    labelPt: 'Região Mineradora',
    summaryPt: 'Montanhas, minas e fundições fortalecem pedra, minério e metal.',
    bonusByStagePt: {
      developing: '+6% Pedra, Minério e Metal',
      consolidated: '+10% Pedra, Minério e Metal',
      specialized: '+15% Pedra, Minério e Metal',
    },
  },
  urban: {
    id: 'urban',
    labelPt: 'Centro Urbano',
    summaryPt: 'Alta densidade habitacional amplia moradia e impostos locais.',
    bonusByStagePt: {
      developing: '+$2 tributo regional',
      consolidated: '+2 Habitação · +$6 tributo regional',
      specialized: '+4 Habitação · +$12 tributo regional',
    },
  },
  commercial: {
    id: 'commercial',
    labelPt: 'Entreposto Comercial',
    summaryPt: 'Mercados e estradas conectadas multiplicam o fluxo de ouro.',
    bonusByStagePt: {
      developing: '+$4 comércio · +3% receita mercantil',
      consolidated: '+$9 comércio · +5% receita mercantil',
      specialized: '+$15 comércio · +8% receita mercantil',
    },
  },
  port: {
    id: 'port',
    labelPt: 'Região Portuária',
    summaryPt: 'Costa, portos e docas impulsionam rotas marítimas e armazéns.',
    bonusByStagePt: {
      developing: '+$4 marítimo · +12 cap. armazéns',
      consolidated: '+$9 marítimo · +25 cap. armazéns',
      specialized: '+$15 marítimo · +40 cap. armazéns',
    },
  },
  academic: {
    id: 'academic',
    labelPt: 'Polo Acadêmico',
    summaryPt: 'Torres arcanas e centros de estudo aceleram a ciência do reino.',
    bonusByStagePt: {
      developing: '+1 Ciência por turno',
      consolidated: '+3 Ciência por turno',
      specialized: '+6 Ciência por turno',
    },
  },
};

const AGRI_BUILDINGS = new Set([
  'building-farm',
  'building-mill',
  'building-sheep',
  'building-watermill',
]);
const MINING_BUILDINGS = new Set(['building-mine', 'building-smelter']);
const FOREST_BUILDINGS = new Set(['dirt-lumber']);
const HOUSING_BUILDINGS = new Set([
  'building-house',
  'building-cabin',
  'building-village',
  'unit-mansion',
  'building-castle',
]);
const COMMERCE_BUILDINGS = new Set(['building-market']);
const PORT_BUILDINGS = new Set(['building-port', 'building-dock', 'bridge']);
const ACADEMIC_BUILDINGS = new Set(['building-wizard-tower']);

function makeBadge(id: RegionalSpecializationId, rawScore: number): RegionalSpecializationBadge {
  const score = Math.round(rawScore);
  const stage = getSpecializationStage(score);
  const meta = REGIONAL_SPECIALIZATION_CATALOG[id];
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

export function evaluateRegionalWorld(params: {
  worldState: HexWorldState;
  cities: Array<{ id: string; name: string; center: AxialCoord; owner: HexOwner; level?: number }>;
  roads: RoadMap;
  connectivity: RoadConnectivitySummary;
  assets: HexAssetEntry[];
  underConstructionKeys?: Set<string>;
  previousPrimaryByCityId?: Record<string, RegionalSpecializationId>;
  owner?: HexOwner;
}): RegionalWorldSummary {
  const {
    worldState,
    cities,
    roads,
    connectivity,
    assets,
    underConstructionKeys,
    previousPrimaryByCityId,
    owner = 'player',
  } = params;

  const ownerCities = cities.filter((c) => c.owner === owner);
  const ownedTiles = Object.values(worldState.hexes).filter((t) => t.owner === owner);

  // 1. Deterministic non-overlapping partition: assign each owned tile to AT MOST ONE controlling city
  const controllingCityIdByHexKey: Record<string, string> = {};
  const regionHexKeysByCityId: Record<string, string[]> = {};
  const tilesByCityId: Record<string, typeof ownedTiles> = {};

  for (const city of ownerCities) {
    regionHexKeysByCityId[city.id] = [];
    tilesByCityId[city.id] = [];
  }

  for (const tile of ownedTiles) {
    const key = hexKey(tile.q, tile.r);
    const tileMetric = connectivity.tileMetricsByKey[key];
    const tileConnected = Boolean(tileMetric?.connectedToCity);

    let bestCity: (typeof ownerCities)[number] | null = null;
    let bestConnectedMatch = false;
    let bestDist = Infinity;
    let bestLevel = -1;

    for (const city of ownerCities) {
      const dist = axialDistance(city.center, tile);
      const centerKey = hexKey(city.center.q, city.center.r);
      const centerNetId = connectivity.tileMetricsByKey[centerKey]?.networkId ?? null;
      const connectedToThisCity =
        dist === 0 ||
        (tileConnected &&
          ((centerNetId !== null && tileMetric?.networkId === centerNetId) ||
            Boolean(tileMetric?.connectedCityIds?.includes(city.id))));

      const maxReach = connectedToThisCity ? 5 : 4;
      if (dist > maxReach) continue;

      const cityLevel = city.level ?? 1;
      const better =
        !bestCity ||
        (connectedToThisCity && !bestConnectedMatch) ||
        (connectedToThisCity === bestConnectedMatch &&
          (dist < bestDist ||
            (dist === bestDist &&
              (cityLevel > bestLevel ||
                (cityLevel === bestLevel && city.id.localeCompare(bestCity.id) < 0)))));

      if (better) {
        bestCity = city;
        bestConnectedMatch = connectedToThisCity;
        bestDist = dist;
        bestLevel = cityLevel;
      }
    }

    if (bestCity) {
      controllingCityIdByHexKey[key] = bestCity.id;
      regionHexKeysByCityId[bestCity.id].push(key);
      tilesByCityId[bestCity.id].push(tile);
    }
  }

  const cityProfilesById: Record<string, RegionalCityProfile> = {};
  const hexBonusesByKey: Record<string, RegionalHexBonus> = {};
  const allDistricts: NaturalDistrict[] = [];

  for (const city of ownerCities) {
    const scores: Record<RegionalSpecializationId, number> = {
      agricultural: 0,
      forestry: 0,
      mining: 0,
      urban: 0,
      commercial: 0,
      port: 0,
      academic: 0,
    };

    const agriKeys: string[] = [];
    const miningKeys: string[] = [];
    const forestKeys: string[] = [];
    const housingKeys: string[] = [];
    const commerceKeys: string[] = [];
    const portKeys: string[] = [];
    const academicKeys: string[] = [];

    let mountainTilesNear = 0;
    let forestTilesNear = 0;
    let waterTilesNear = 0;
    let roadTilesNear = 0;
    let roadConnectedTileCount = 0;

    const assignedTiles = tilesByCityId[city.id] ?? [];

    for (const tile of assignedTiles) {
      const dist = axialDistance(city.center, tile);
      const key = hexKey(tile.q, tile.r);
      const terrain = getHexTerrainAndResource(tile.q, tile.r, tile);
      const assetName = assets[tile.structureIndex]?.name ?? '';
      const isComplete = !underConstructionKeys?.has(key);
      const hasRoad = Boolean(roads[key]);
      const connected = Boolean(connectivity.tileMetricsByKey[key]?.connectedToCity);

      if (hasRoad) roadTilesNear += 1;
      if (connected) roadConnectedTileCount += 1;

      const distWeight = dist <= 2 ? 1.0 : dist === 3 ? 0.78 : 0.58;
      const roadWeight = connected ? 1.35 : 0.75;
      const weight = distWeight * roadWeight;

      const hasWaterNeighbor = AXIAL_DIRECTIONS.some((dir) => {
        const nq = tile.q + dir.q;
        const nr = tile.r + dir.r;
        const nTile = worldState.hexes[hexKey(nq, nr)];
        return getHexTerrainAndResource(nq, nr, nTile).terrainType === 'water';
      });

      if (terrain.terrainType === 'fertile') scores.agricultural += 1.6 * weight;
      if (terrain.terrainType === 'forest') {
        scores.forestry += 1.7 * weight;
        forestTilesNear += 1;
      }
      if (terrain.terrainType === 'mountain') {
        scores.mining += 1.9 * weight;
        mountainTilesNear += 1;
      }
      if (terrain.terrainType === 'water') {
        scores.port += 1.1 * weight;
        scores.commercial += 0.5 * weight;
        waterTilesNear += 1;
      } else if (hasWaterNeighbor) {
        scores.port += 0.65 * distWeight;
        waterTilesNear += 0.5;
      }

      if (!isComplete) continue;

      if (AGRI_BUILDINGS.has(assetName)) {
        scores.agricultural += 5.4 * weight + (connected ? 1.6 : 0);
        agriKeys.push(key);
      }
      if (MINING_BUILDINGS.has(assetName)) {
        scores.mining += 6.2 * weight + (connected ? 1.6 : 0);
        miningKeys.push(key);
      }
      if (FOREST_BUILDINGS.has(assetName)) {
        scores.forestry += 6.2 * weight + (connected ? 1.6 : 0);
        forestKeys.push(key);
      }
      if (HOUSING_BUILDINGS.has(assetName)) {
        const bDef = getBuildingDefinition(assetName);
        scores.urban += (Math.min(8, bDef.housingCapacity) * 0.38 + 1.2) * weight;
        housingKeys.push(key);
      }
      if (COMMERCE_BUILDINGS.has(assetName)) {
        scores.commercial += 6.2 * weight + (hasRoad ? 2.6 : 0);
        if (hasWaterNeighbor) scores.port += 2.2 * weight;
        commerceKeys.push(key);
      }
      if (PORT_BUILDINGS.has(assetName)) {
        const basePortPts = assetName === 'building-port' ? 8.5 : assetName === 'building-dock' ? 5.8 : 2.8;
        scores.port += basePortPts * weight + (connected ? 2.0 : 0);
        scores.commercial += (assetName === 'building-port' ? 2.2 : 1.0) * weight;
        portKeys.push(key);
      }
      if (ACADEMIC_BUILDINGS.has(assetName)) {
        scores.academic += 8.2 * weight + (connected ? 2.2 : 0);
        academicKeys.push(key);
      }

      const modWeights = aggregateTileModuleEffects(assetName, getInstalledModules(tile)).regionalWeights;
      for (const specId of Object.keys(modWeights) as RegionalSpecializationId[]) {
        scores[specId] += modWeights[specId] ?? 0;
      }
    }

    if (roadTilesNear >= 2) {
      scores.commercial += Math.min(6.5, roadTilesNear * 1.45);
      scores.urban += Math.min(4, roadTilesNear * 0.9);
      if (waterTilesNear >= 1) {
        scores.port += Math.min(3.5, roadTilesNear * 0.8);
      }
    }

    const sortedCandidates = (Object.entries(scores) as Array<[RegionalSpecializationId, number]>)
      .filter(([, s]) => s >= SPECIALIZATION_STAGE_META.developing.minScore)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    let primaryEntry: [RegionalSpecializationId, number] =
      sortedCandidates[0] ?? ['urban', Math.max(4, Math.round(scores.urban || 4))];

    // Hysteresis: retain previous specialization unless a new specialization leads by >= HYSTERESIS_MARGIN
    const prevPrimaryId = previousPrimaryByCityId?.[city.id];
    if (prevPrimaryId && prevPrimaryId !== primaryEntry[0]) {
      const prevScore = scores[prevPrimaryId] ?? 0;
      if (
        prevScore >= SPECIALIZATION_STAGE_META.developing.minScore &&
        primaryEntry[1] < prevScore + HYSTERESIS_MARGIN
      ) {
        primaryEntry = [prevPrimaryId, prevScore];
      }
    }

    const primarySpecialization = makeBadge(primaryEntry[0], primaryEntry[1]);

    const secondaryBadges = sortedCandidates
      .filter(([id]) => id !== primarySpecialization.id)
      .slice(0, 2)
      .map(([id, score]) => makeBadge(id, score));

    const specializations: RegionalSpecializationBadge[] = [
      primarySpecialization,
      ...secondaryBadges,
    ];

    // Emergent Natural Districts inside the city's assigned region
    const districts: NaturalDistrict[] = [];
    const assignDistrict = (
      type: NaturalDistrictType,
      labelPt: string,
      keys: string[],
      bonusPct: number,
      bonusGoldFlat: number,
      summaryPt: string
    ) => {
      if (keys.length === 0) return;
      const district: NaturalDistrict = {
        id: `${city.id}:${type}`,
        cityId: city.id,
        type,
        labelPt,
        hexKeys: keys,
        bonusPct,
        bonusGoldFlat,
        summaryPt,
      };
      districts.push(district);
      allDistricts.push(district);
      for (const k of keys) {
        const existing = hexBonusesByKey[k];
        const nextMult = Number((1 + bonusPct / 100).toFixed(2));
        if (!existing || nextMult > existing.multiplier) {
          hexBonusesByKey[k] = {
            districtId: district.id,
            districtLabelPt: labelPt,
            districtType: type,
            multiplier: nextMult,
            bonusGoldFlat,
          };
        }
      }
    };

    const hasRoadLink = (keys: string[]) =>
      keys.some((k) => Boolean(roads[k]) || Boolean(connectivity.tileMetricsByKey[k]?.connectedToCity));

    if (agriKeys.length >= 2) {
      const roadBoost = hasRoadLink(agriKeys) ? 4 : 0;
      const pct = 8 + roadBoost;
      assignDistrict(
        'agricultural',
        'Distrito Agrícola',
        agriKeys,
        pct,
        0,
        `+${pct}% produção agrícola em ${agriKeys.length} terras`
      );
    }

    if (
      miningKeys.length >= 2 ||
      (miningKeys.length >= 1 && mountainTilesNear >= 2 && hasRoadLink(miningKeys))
    ) {
      const pct = miningKeys.length >= 2 ? 12 : 8;
      assignDistrict(
        'mining',
        'Distrito Minerador',
        miningKeys,
        pct,
        0,
        `+${pct}% minério, pedra e metal`
      );
    }

    if (
      forestKeys.length >= 2 ||
      (forestKeys.length >= 1 && forestTilesNear >= 2 && hasRoadLink(forestKeys))
    ) {
      const pct = forestKeys.length >= 2 ? 12 : 8;
      assignDistrict(
        'forestry',
        'Distrito Florestal',
        forestKeys,
        pct,
        0,
        `+${pct}% produção de madeira`
      );
    }

    if (housingKeys.length >= 3) {
      assignDistrict(
        'residential',
        'Distrito Residencial',
        housingKeys,
        8,
        1,
        `+${housingKeys.length} núcleos habitacionais (+1 Ouro/prédio)`
      );
    }

    if (
      commerceKeys.length >= 2 ||
      (commerceKeys.length >= 1 && roadTilesNear >= 2)
    ) {
      const pct = commerceKeys.length >= 2 ? 14 : 9;
      assignDistrict(
        'commercial',
        'Distrito Comercial',
        commerceKeys,
        pct,
        2,
        `+${pct}% receita comercial (+2 Ouro)`
      );
    }

    if (
      portKeys.length >= 2 ||
      (portKeys.length >= 1 && (waterTilesNear >= 1.5 || hasRoadLink(portKeys)))
    ) {
      const pct = portKeys.length >= 2 ? 14 : 9;
      assignDistrict(
        'port',
        'Distrito Portuário',
        portKeys,
        pct,
        2,
        `+${pct}% rendimento costeiro (+2 Ouro)`
      );
    }

    if (academicKeys.length >= 1 && (housingKeys.length >= 2 || hasRoadLink(academicKeys))) {
      assignDistrict(
        'academic',
        'Distrito Acadêmico',
        academicKeys,
        12,
        0,
        '+12% ciência local'
      );
    }

    const localProductionBonusPct = Math.min(
      18,
      districts.reduce((sum, d) => sum + Math.round(d.bonusPct / 2), 0)
    );

    cityProfilesById[city.id] = {
      cityId: city.id,
      primarySpecialization,
      specializations,
      districts,
      regionHexKeys: regionHexKeysByCityId[city.id] ?? [],
      roadConnectedTileCount,
      localProductionBonusPct,
    };
  }

  // Regional Trade Corridors between connected cities with complementary specializations
  const tradeCorridors: TradeCorridor[] = [];
  let corridorTradeGold = 0;
  const cityById = new Map(ownerCities.map((c) => [c.id, c]));

  for (const net of connectivity.networks) {
    if (net.connectedCityIds.length < 2) continue;
    for (let i = 0; i < net.connectedCityIds.length; i++) {
      for (let j = i + 1; j < net.connectedCityIds.length; j++) {
        const idA = net.connectedCityIds[i];
        const idB = net.connectedCityIds[j];
        const cityA = cityById.get(idA);
        const cityB = cityById.get(idB);
        if (!cityA || !cityB) continue;

        const specA = cityProfilesById[idA]?.primarySpecialization.id ?? 'urban';
        const specB = cityProfilesById[idB]?.primarySpecialization.id ?? 'urban';
        const complementary = specA !== specB;
        const goldBonus = complementary
          ? 8 + Math.round(net.avgLevel * 2)
          : 5 + Math.round(net.avgLevel);
        corridorTradeGold += goldBonus;
        tradeCorridors.push({
          id: `${idA}<->${idB}`,
          cityAId: idA,
          cityAName: cityA.name,
          cityBId: idB,
          cityBName: cityB.name,
          labelPt: complementary
            ? `${REGIONAL_SPECIALIZATION_CATALOG[specA].labelPt} ↔ ${REGIONAL_SPECIALIZATION_CATALOG[specB].labelPt}`
            : `Eixo ${cityA.name} ↔ ${cityB.name}`,
          goldBonus,
        });
      }
    }
  }

  return {
    cityProfilesById,
    controllingCityIdByHexKey,
    regionHexKeysByCityId,
    hexBonusesByKey,
    allDistricts,
    tradeCorridors,
    corridorTradeGold,
  };
}

