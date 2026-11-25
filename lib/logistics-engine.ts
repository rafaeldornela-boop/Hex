import { hexKey, type AxialCoord } from './hex-engine';
import {
  ROAD_CATALOG,
  type RoadConnectivitySummary,
  type RoadLevel,
  type RoadMap,
} from './road-engine';
import { AXIAL_DIRECTIONS, axialDistance } from './territory-engine';

export type LogisticsStatus = 'optimal' | 'connected' | 'strained' | 'isolated';

export interface BuildingLogisticsReport {
  factor: number;
  efficiencyPct: number;
  status: LogisticsStatus;
  labelPt: string;
  hasRoad: boolean;
  roadLevel: number;
  connectedToCity: boolean;
  connectedCityCount: number;
  distToCity: number;
  notesPt: string[];
}

export function computeBuildingLogistics(params: {
  q: number;
  r: number;
  cityCenters: AxialCoord[];
  roads?: RoadMap;
  connectivity?: RoadConnectivitySummary;
}): BuildingLogisticsReport {
  const { q, r, cityCenters, roads = {}, connectivity } = params;
  const key = hexKey(q, r);
  const roadTile = roads[key];
  const hasRoad = Boolean(roadTile);
  const roadLevel = roadTile?.level ?? 0;

  const metric = connectivity?.tileMetricsByKey[key];
  let connectedToCity = metric?.connectedToCity ?? false;
  let connectedCityCount = metric?.connectedCityCount ?? 0;

  // Immediate neighbor road also provides partial access to road-connected buildings
  let adjacentRoadLevel = 0;
  let adjacentConnectedToCity = false;
  for (const dir of AXIAL_DIRECTIONS) {
    const nKey = hexKey(q + dir.q, r + dir.r);
    const nRoad = roads[nKey];
    if (nRoad && nRoad.level > adjacentRoadLevel) {
      adjacentRoadLevel = nRoad.level;
    }
    const nMetric = connectivity?.tileMetricsByKey[nKey];
    if (nMetric?.connectedToCity) {
      adjacentConnectedToCity = true;
      connectedCityCount = Math.max(connectedCityCount, nMetric.connectedCityCount);
    }
  }

  let distToCity = Infinity;
  for (const c of cityCenters) {
    const d = axialDistance({ q, r }, c);
    if (d < distToCity) distToCity = d;
  }

  const notesPt: string[] = [];
  let factor = 1.0;
  let status: LogisticsStatus = 'connected';
  let labelPt = 'Conectado';

  if (!Number.isFinite(distToCity)) {
    return {
      factor: 1.0,
      efficiencyPct: 100,
      status: 'connected',
      labelPt: 'Local',
      hasRoad,
      roadLevel,
      connectedToCity,
      connectedCityCount,
      distToCity: 0,
      notesPt: [],
    };
  }

  const effectiveRoadLevel = Math.max(
    roadLevel,
    metric?.isBridge ? 2 : 0
  ) as RoadLevel | 0;

  if (distToCity <= 1) {
    // Immediate urban core around a city center operates smoothly at baseline,
    // and gains steady logistics improvements from paved/trade roads & inter-city links.
    if (hasRoad && effectiveRoadLevel > 0) {
      const roadDef = ROAD_CATALOG[effectiveRoadLevel as RoadLevel];
      const networkExtra = connectedCityCount >= 2 ? 0.04 : 0;
      factor = 1.0 + Math.min(0.22, roadDef.logisticsBonusPct / 100 + networkExtra);
      status = effectiveRoadLevel >= 3 || connectedCityCount >= 2 ? 'optimal' : 'connected';
      labelPt = status === 'optimal' ? 'Logística Ótima' : 'Conectado';
      notesPt.push(`${roadDef.namePt} (+${Math.round((factor - 1) * 100)}%)`);
    } else {
      factor = 1.0;
      status = 'connected';
      labelPt = 'Núcleo Urbano';
    }
  } else if (connectedToCity && effectiveRoadLevel > 0) {
    const roadDef = ROAD_CATALOG[effectiveRoadLevel as RoadLevel];
    const networkExtra = connectedCityCount >= 2 ? 0.05 : 0;
    factor = 1.0 + Math.min(0.24, roadDef.logisticsBonusPct / 100 + networkExtra);
    status = effectiveRoadLevel >= 3 || connectedCityCount >= 2 ? 'optimal' : 'connected';
    labelPt = status === 'optimal' ? 'Rota Eficiente' : 'Ligado à Cidade';
    notesPt.push(
      `${roadDef.namePt} ligada à cidade (+${Math.round((factor - 1) * 100)}%)`
    );
  } else if (hasRoad) {
    // Road built on tile, not yet connected to any city network
    factor = 0.94;
    status = 'strained';
    labelPt = 'Via Isolada';
    notesPt.push('Estrada sem conexão à cidade (-6%)');
  } else if (adjacentConnectedToCity && distToCity === 2) {
    factor = 0.97;
    status = 'connected';
    labelPt = 'Acesso Próximo';
    notesPt.push('Estrada vizinha próxima (-3%)');
  } else if (distToCity === 2) {
    factor = 0.9;
    status = 'strained';
    labelPt = 'Sem Estrada';
    notesPt.push('Sem estrada até a cidade (-10%)');
  } else {
    // Distant hex (distance >= 3) with no road connection suffers clear isolation penalty
    factor = Math.max(0.76, Number((0.9 - (distToCity - 2) * 0.05).toFixed(2)));
    status = 'isolated';
    labelPt = 'Isolado';
    notesPt.push(
      `Distante sem estrada (-${Math.round((1 - factor) * 100)}%)`
    );
  }

  return {
    factor: Number(factor.toFixed(2)),
    efficiencyPct: Math.round(factor * 100),
    status,
    labelPt,
    hasRoad,
    roadLevel,
    connectedToCity: connectedToCity || distToCity <= 1,
    connectedCityCount,
    distToCity,
    notesPt,
  };
}
