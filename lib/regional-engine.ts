import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import { hexKey, type AxialCoord, type HexOwner, type HexWorldState } from './hex-engine';
import type { RoadConnectivitySummary, RoadMap } from './road-engine';
import { getHexTerrainAndResource } from './terrain-engine';
import { axialDistance } from './territory-engine';

export type RegionalSpecializationId =
  | 'agricultural'
  | 'forestry'
  | 'mining'
  | 'urban'
  | 'commercial'
  | 'academic';

export interface RegionalSpecializationBadge {
  id: RegionalSpecializationId;
  labelPt: string;
  score: number;
  summaryPt: string;
}

export type NaturalDistrictType =
  | 'agricultural'
  | 'mining'
  | 'forestry'
  | 'residential'
  | 'commercial'
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
  specializations: RegionalSpecializationBadge[];
  districts: NaturalDistrict[];
  localProductionBonusPct: number;
}

export interface RegionalWorldSummary {
  cityProfilesById: Record<string, RegionalCityProfile>;
  hexBonusesByKey: Record<string, RegionalHexBonus>;
  allDistricts: NaturalDistrict[];
  tradeCorridors: TradeCorridor[];
  corridorTradeGold: number;
}

const SPEC_META: Record<
  RegionalSpecializationId,
  { labelPt: string; summaryPt: string }
> = {
  agricultural: {
    labelPt: 'Região Agrícola',
    summaryPt: 'Solos férteis, fazendas e moinhos impulsionam alimentos.',
  },
  forestry: {
    labelPt: 'Região Madeireira',
    summaryPt: 'Bosques e serrarias sustentam madeira e obras.',
  },
  mining: {
    labelPt: 'Região Mineradora',
    summaryPt: 'Montanhas, minas e fundições fortalecem pedra, minério e metal.',
  },
  urban: {
    labelPt: 'Centro Urbano',
    summaryPt: 'Alta densidade habitacional amplia mão de obra e impostos.',
  },
  commercial: {
    labelPt: 'Entreposto Comercial',
    summaryPt: 'Mercados, portos e estradas multiplicam o fluxo de ouro.',
  },
  academic: {
    labelPt: 'Polo Acadêmico',
    summaryPt: 'Universidades aceleram a pesquisa científica do reino.',
  },
};

const AGRI_BUILDINGS = new Set([
  'building-farm',
  'building-mill',
  'building-sheep',
  'building-watermill',
  'building-dock',
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
const COMMERCE_BUILDINGS = new Set([
  'building-market',
  'building-port',
  'bridge',
]);
const ACADEMIC_BUILDINGS = new Set(['building-wizard-tower']);

export function evaluateRegionalWorld(params: {
  worldState: HexWorldState;
  cities: Array<{ id: string; name: string; center: AxialCoord; owner: HexOwner }>;
  roads: RoadMap;
  connectivity: RoadConnectivitySummary;
  assets: HexAssetEntry[];
  underConstructionKeys?: Set<string>;
  owner?: HexOwner;
}): RegionalWorldSummary {
  const {
    worldState,
    cities,
    roads,
    connectivity,
    assets,
    underConstructionKeys,
    owner = 'player',
  } = params;

  const ownedTiles = Object.values(worldState.hexes).filter(
    (t) => t.owner === owner
  );

  const cityProfilesById: Record<string, RegionalCityProfile> = {};
  const hexBonusesByKey: Record<string, RegionalHexBonus> = {};
  const allDistricts: NaturalDistrict[] = [];

  for (const city of cities) {
    if (city.owner !== owner) continue;

    const scores: Record<RegionalSpecializationId, number> = {
      agricultural: 0,
      forestry: 0,
      mining: 0,
      urban: 0,
      commercial: 0,
      academic: 0,
    };

    const agriKeys: string[] = [];
    const miningKeys: string[] = [];
    const forestKeys: string[] = [];
    const housingKeys: string[] = [];
    const commerceKeys: string[] = [];
    const academicKeys: string[] = [];

    let mountainTilesNear = 0;
    let forestTilesNear = 0;
    let roadTilesNear = 0;

    for (const tile of ownedTiles) {
      const dist = axialDistance(city.center, tile);
      if (dist > 3) continue;

      const key = hexKey(tile.q, tile.r);
      const terrain = getHexTerrainAndResource(tile.q, tile.r, tile);
      const assetName = assets[tile.structureIndex]?.name ?? '';
      const isComplete = !underConstructionKeys?.has(key);
      const hasRoad = Boolean(roads[key]);
      const connected = Boolean(connectivity.tileMetricsByKey[key]?.connectedToCity);
      const weight = dist <= 2 ? 1.0 : 0.65;

      if (hasRoad) roadTilesNear += 1;

      if (terrain.terrainType === 'fertile') scores.agricultural += 1.5 * weight;
      if (terrain.terrainType === 'forest') {
        scores.forestry += 1.6 * weight;
        forestTilesNear += 1;
      }
      if (terrain.terrainType === 'mountain') {
        scores.mining += 1.8 * weight;
        mountainTilesNear += 1;
      }
      if (terrain.terrainType === 'water') {
        scores.commercial += 0.8 * weight;
        scores.agricultural += 0.5 * weight;
      }

      if (!isComplete) continue;

      if (AGRI_BUILDINGS.has(assetName)) {
        scores.agricultural += 5 * weight + (connected ? 1.5 : 0);
        agriKeys.push(key);
      }
      if (MINING_BUILDINGS.has(assetName)) {
        scores.mining += 6 * weight + (connected ? 1.5 : 0);
        miningKeys.push(key);
      }
      if (FOREST_BUILDINGS.has(assetName)) {
        scores.forestry += 6 * weight + (connected ? 1.5 : 0);
        forestKeys.push(key);
      }
      if (HOUSING_BUILDINGS.has(assetName)) {
        const bDef = getBuildingDefinition(assetName);
        scores.urban += (bDef.housingCapacity * 0.45 + 1.5) * weight;
        housingKeys.push(key);
      }
      if (COMMERCE_BUILDINGS.has(assetName)) {
        scores.commercial += 6 * weight + (hasRoad ? 2.5 : 0);
        commerceKeys.push(key);
      }
      if (ACADEMIC_BUILDINGS.has(assetName)) {
        scores.academic += 8 * weight + (connected ? 2 : 0);
        academicKeys.push(key);
      }
    }

    if (roadTilesNear >= 2) {
      scores.commercial += Math.min(6, roadTilesNear * 1.4);
      scores.urban += Math.min(4, roadTilesNear);
    }

    const specializations: RegionalSpecializationBadge[] = (
      Object.entries(scores) as Array<[RegionalSpecializationId, number]>
    )
      .filter(([, s]) => s >= 6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, score]) => ({
        id,
        labelPt: SPEC_META[id].labelPt,
        score: Math.round(score),
        summaryPt: SPEC_META[id].summaryPt,
      }));

    if (specializations.length === 0) {
      specializations.push({
        id: 'urban',
        labelPt: SPEC_META.urban.labelPt,
        score: 4,
        summaryPt: SPEC_META.urban.summaryPt,
      });
    }

    // Emergent Natural Districts (organic spatial clusters linked by city proximity or roads)
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
      specializations,
      districts,
      localProductionBonusPct,
    };
  }

  // Regional Trade Corridors between connected cities with complementary specializations
  const tradeCorridors: TradeCorridor[] = [];
  let corridorTradeGold = 0;
  const cityById = new Map(cities.map((c) => [c.id, c]));

  for (const net of connectivity.networks) {
    if (net.connectedCityIds.length < 2) continue;
    for (let i = 0; i < net.connectedCityIds.length; i++) {
      for (let j = i + 1; j < net.connectedCityIds.length; j++) {
        const idA = net.connectedCityIds[i];
        const idB = net.connectedCityIds[j];
        const cityA = cityById.get(idA);
        const cityB = cityById.get(idB);
        if (!cityA || !cityB) continue;

        const specA = cityProfilesById[idA]?.specializations[0]?.id ?? 'urban';
        const specB = cityProfilesById[idB]?.specializations[0]?.id ?? 'urban';
        const complementary = specA !== specB;
        const goldBonus = complementary ? 8 + Math.round(net.avgLevel * 2) : 5 + Math.round(net.avgLevel);
        corridorTradeGold += goldBonus;
        tradeCorridors.push({
          id: `${idA}<->${idB}`,
          cityAId: idA,
          cityAName: cityA.name,
          cityBId: idB,
          cityBName: cityB.name,
          labelPt: complementary
            ? `${SPEC_META[specA].labelPt} ↔ ${SPEC_META[specB].labelPt}`
            : `Eixo ${cityA.name} ↔ ${cityB.name}`,
          goldBonus,
        });
      }
    }
  }

  return {
    cityProfilesById,
    hexBonusesByKey,
    allDistricts,
    tradeCorridors,
    corridorTradeGold,
  };
}
