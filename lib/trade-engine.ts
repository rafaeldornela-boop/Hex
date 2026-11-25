import type { HexAssetEntry } from './godot-docs';
import type { KingdomResources, TurnProductionBreakdown } from './economy-engine';
import type { ActiveWorldEffect } from './events-engine';
import type { FactionState } from './faction-engine';
import { hexKey, type HexWorldState } from './hex-engine';
import type { TechId } from './tech-engine';

export type TradableResource = 'wood' | 'stone' | 'food' | 'ore';
export type MarketSupplyState = 'excedente' | 'equilibrado' | 'escassez';

export interface ResourceMarketQuote {
  resource: TradableResource;
  labelPt: string;
  stock: number;
  cap: number;
  netPerTurn: number;
  condition: MarketSupplyState;
  conditionLabelPt: string;
  buyPricePerUnit: number;
  sellPricePerUnit: number;
}

export interface MarketSummary {
  quotes: ResourceMarketQuote[];
  marketCount: number;
  tradeBonusPercent: number;
}

const BASE_PRICES: Record<TradableResource, { labelPt: string; base: number }> = {
  wood: { labelPt: 'Madeira', base: 8 },
  stone: { labelPt: 'Pedra', base: 10 },
  food: { labelPt: 'Alimento', base: 7 },
  ore: { labelPt: 'Minério', base: 14 },
};

export function countTradeStructures(
  worldState: HexWorldState,
  assets: HexAssetEntry[],
  underConstructionKeys?: Set<string>
): number {
  let count = 0;
  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== 'player') continue;
    if (underConstructionKeys?.has(hexKey(tile.q, tile.r))) continue;
    const name = assets[tile.structureIndex]?.name ?? '';
    if (name === 'building-market' || name === 'building-port') {
      count += 1;
    }
  }
  return count;
}

export function computeMarketSummary(params: {
  worldState: HexWorldState;
  resources: KingdomResources;
  economy: TurnProductionBreakdown;
  unlockedTechs: TechId[];
  factions: FactionState[];
  activeEffects: ActiveWorldEffect[];
  assets: HexAssetEntry[];
  underConstructionKeys?: Set<string>;
}): MarketSummary {
  const {
    worldState,
    resources,
    economy,
    unlockedTechs,
    factions,
    activeEffects,
    assets,
    underConstructionKeys,
  } = params;

  const marketCount = countTradeStructures(worldState, assets, underConstructionKeys);
  const hasTradeTech = unlockedTechs.includes('trade');
  const activePacts = factions.filter((f) => f.relation === 'trade_pact').length;

  // Trade bonus lowers buy prices and raises sell prices cleanly (up to +30%)
  const bonusPct = Math.min(30, marketCount * 6 + (hasTradeTech ? 10 : 0) + activePacts * 5);
  const buyDiscount = 1 - bonusPct / 150;
  const sellBonus = 1 + bonusPct / 100;

  const droughtActive = activeEffects.some((e) => (e.foodMultiplierMod ?? 1) < 0.9);
  const crisisActive = activeEffects.some((e) => (e.goldMultiplierMod ?? 1) < 0.9);

  const resourceOrder: TradableResource[] = ['wood', 'stone', 'food', 'ore'];
  const quotes: ResourceMarketQuote[] = resourceOrder.map((res) => {
    const meta = BASE_PRICES[res];
    const stock = resources[res];
    const cap = economy.storageCaps[res];
    const netPerTurn =
      res === 'wood'
        ? economy.woodNet
        : res === 'stone'
          ? economy.stoneNet
          : res === 'food'
            ? economy.foodNet
            : economy.oreNet;

    const ratio = cap > 0 ? stock / cap : 0;

    let condition: MarketSupplyState = 'equilibrado';
    if (
      (res === 'food' && droughtActive) ||
      netPerTurn < 0 ||
      stock < 25
    ) {
      condition = 'escassez';
    } else if (ratio >= 0.55 || netPerTurn >= 8 || stock >= 140) {
      condition = 'excedente';
    }

    const conditionFactor =
      condition === 'escassez' ? 1.35 : condition === 'excedente' ? 0.78 : 1.0;
    const crisisFactor = crisisActive ? 1.1 : 1.0;

    const midPrice = meta.base * conditionFactor * crisisFactor;
    const buyPricePerUnit = Math.max(4, Math.round(midPrice * 1.2 * buyDiscount));
    const sellPricePerUnit = Math.max(
      3,
      Math.min(buyPricePerUnit - 1, Math.round(midPrice * 0.72 * sellBonus))
    );

    const conditionLabelPt =
      condition === 'escassez'
        ? 'Escassez'
        : condition === 'excedente'
          ? 'Excedente'
          : 'Equilibrado';

    return {
      resource: res,
      labelPt: meta.labelPt,
      stock,
      cap,
      netPerTurn,
      condition,
      conditionLabelPt,
      buyPricePerUnit,
      sellPricePerUnit,
    };
  });

  return {
    quotes,
    marketCount,
    tradeBonusPercent: bonusPct,
  };
}
