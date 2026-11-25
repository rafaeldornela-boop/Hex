'use client';

import { memo, useMemo } from 'react';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coins,
  Crosshair,
  Crown,
  FastForward,
  Flag,
  Flame,
  FlaskConical,
  FolderOpen,
  Hammer,
  Layers,
  Lock,
  Menu,
  Mountain,
  Pause,
  Pickaxe,
  Play,
  RotateCcw,
  RotateCw,
  Route,
  Save,
  Sparkles,
  Swords,
  Trash2,
  Trees,
  Users,
  Volume2,
  VolumeX,
  Wheat,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { HexAssetEntry } from '@/lib/godot-docs';
import type { AxialCoord } from '@/lib/hex-engine';
import type {
  ActiveExpansion,
  ExpansionCheckResult,
  TerritorialCapacitySummary,
} from '@/lib/territory-engine';
import { getExpansionFailureMessage } from '@/lib/territory-engine';
import {
  TERRAIN_METADATA,
  getStructureDisplayInfo,
  type StrategicRegionInfo,
  type TerrainDescriptor,
} from '@/lib/terrain-engine';
import {
  getBuildingDefinition,
  type BuildingDefinition,
  type ResourceCost,
} from '@/lib/buildings-catalog';
import type { HexBuildEvaluation } from '@/lib/build-rules';
import type {
  BuildingOperationReport,
  KingdomResources,
  KingdomStageInfo,
  TurnProductionBreakdown,
} from '@/lib/economy-engine';
import type { ActiveKingdomEvent, ActiveWorldEffect } from '@/lib/events-engine';
import type { FactionState } from '@/lib/faction-engine';
import type { ActiveConstruction } from '@/lib/kingdom-engine';
import { UNIT_CATALOG, type UnitEntity, type UnitType } from '@/lib/military-engine';
import { TECH_BY_ID, type TechId } from '@/lib/tech-engine';
import {
  ROAD_CATALOG,
  type RoadLevelDefinition,
  type RoadTile,
} from '@/lib/road-engine';
import type { CityEntity } from '@/lib/city-engine';
import { formatHexDisplayName } from '@/lib/world-domain';
import type { BuilderToolMode, GameModeState } from './HexSceneController';
import type { KingdomModalTab } from './KingdomModal';

export interface RoadBuildCheckView {
  allowed: boolean;
  isUpgrade: boolean;
  definition: RoadLevelDefinition | null;
  reasonPt: string | null;
}

export interface GameHudProps {
  gameState: GameModeState;
  turn: number;
  worldSeed?: number;
  cash: number;
  territoryCount: number;
  territorySummary: TerritorialCapacitySummary;
  resources: KingdomResources;
  economy: TurnProductionBreakdown;
  cities: CityEntity[];
  stage: KingdomStageInfo;
  unlockedTechs: TechId[];
  activeEvent: ActiveKingdomEvent | null;
  activeEffects: ActiveWorldEffect[];
  autoTurnEnabled: boolean;
  commandModeActive: boolean;
  selectedIndex: number;
  toolMode: BuilderToolMode;
  selectedHex: AxialCoord | null;
  selectedHexOwned: boolean;
  selectedHexHasConstruction: boolean;
  selectedHexConstruction: ActiveConstruction | null;
  selectedHexActiveExpansion: ActiveExpansion | null;
  selectedTileAssetName: string | null;
  selectedExpansion: ExpansionCheckResult | null;
  selectedTerrainInfo: TerrainDescriptor | null;
  selectedStrategicInfo: StrategicRegionInfo | null;
  selectedHexUnit: UnitEntity | null;
  selectedHexFaction: FactionState | null;
  selectedBuildingReport: BuildingOperationReport | null;
  selectedCity: CityEntity | null;
  selectedRoad: RoadTile | null;
  selectedRoadCheck: RoadBuildCheckView | null;
  contextualBuild: HexBuildEvaluation | null;
  canBuildActiveOnSelected: boolean;
  activeBuildEffectiveCost: ResourceCost | null;
  assets: HexAssetEntry[];
  muted: boolean;
  dockOpen: boolean;
  buildSheetOpen: boolean;
  toastMessage: string | null;
  onStartGame: () => void;
  onResume: () => void;
  onPause: () => void;
  onBackToTitle: () => void;
  onResetStarter: () => void;
  onNewProceduralWorld: () => void;
  onClearMap: () => void;
  onAdvanceTurn: () => void;
  onToggleAutoTurn: () => void;
  onOpenKingdomModal: (tab?: KingdomModalTab) => void;
  onSelectPiece: (index: number) => void;
  onBuildOptionOnSelected: (structureIndex: number) => void;
  onCyclePiece: (delta: number) => void;
  onRotatePiece: () => void;
  onSetToolMode: (mode: BuilderToolMode) => void;
  onConfirmSelectedHex: () => void;
  onBuildRoadSelected: () => void;
  onDemolishSelectedHex: () => void;
  onRecruitUnit: (unitType: UnitType) => void;
  onStartUnitCommand: () => void;
  onCancelAction: () => void;
  onSaveMap: () => void;
  onLoadMap: () => void;
  onToggleMute: () => void;
  onToggleDock: () => void;
  onSetBuildSheetOpen: (open: boolean) => void;
  onCenterCamera: () => void;
  onZoom: (delta: number) => void;
  onRotateCamera: (radians: number) => void;
}

function formatCash(value: number): string {
  return `$${Math.round(value).toLocaleString('pt-BR')}`;
}

function formatCompactCost(cost: ResourceCost | null, fallbackGold: number): string {
  if (!cost) return fallbackGold > 0 ? formatCash(fallbackGold) : 'Grátis';
  const parts: string[] = [];
  if (cost.gold > 0) parts.push(formatCash(cost.gold));
  if (cost.wood > 0) parts.push(`${cost.wood} Mad`);
  if (cost.stone > 0) parts.push(`${cost.stone} Ped`);
  if (cost.ore > 0) parts.push(`${cost.ore} Min`);
  if (cost.metal > 0) parts.push(`${cost.metal} Met`);
  return parts.length > 0 ? parts.join(' · ') : 'Grátis';
}

function formatLiveBuildingYield(
  report: BuildingOperationReport,
  def: BuildingDefinition
): string {
  const parts: string[] = [];
  const p = report.actualProduction;
  if (def.housingCapacity > 0) parts.push(`+${def.housingCapacity} Moradia`);
  if (p.gold > 0) parts.push(`+${p.gold} Ouro`);
  if (p.wood > 0) parts.push(`+${p.wood} Mad`);
  if (p.stone > 0) parts.push(`+${p.stone} Ped`);
  if (p.food > 0) parts.push(`+${p.food} Alim`);
  if (p.ore > 0) parts.push(`+${p.ore} Min`);
  if (p.metal > 0) parts.push(`+${p.metal} Met`);
  if (p.science > 0) parts.push(`+${p.science} Ciên`);
  if (def.defenseBonus > 0) parts.push(`+${def.defenseBonus} Def`);
  if (def.storageBonus > 0) parts.push(`+${def.storageBonus} Arm`);
  return parts.length > 0 ? parts.join(' · ') : def.summaryPt;
}

function getExpansionButtonLabel(check: ExpansionCheckResult): string {
  if (check.canExpand) {
    return `Incorporar (${check.turnsRequired}t · ${check.workersRequired} trab.)`;
  }
  switch (check.reason) {
    case 'capacity_reached':
      return 'Capacidade esgotada';
    case 'requires_tech':
      return check.requiredTech
        ? `Requer ${TECH_BY_ID[check.requiredTech].namePt}`
        : 'Pesquisa necessária';
    case 'insufficient_influence':
      return `Influência ${check.influence.score}/${check.influence.requiredInfluence}`;
    case 'insufficient_workers':
      return `Precisa ${check.workersRequired} trab.`;
    case 'out_of_reach':
      return 'Fora do alcance';
    default:
      return 'Fora da fronteira';
  }
}

function getExpansionDotColor(
  selectedHexFaction: FactionState | null,
  selectedExpansion: ExpansionCheckResult,
  selectedHexActiveExpansion: ActiveExpansion | null
): string {
  if (selectedHexFaction) return selectedHexFaction.colorHex;
  if (selectedExpansion.owner === 'player') return '#059669';
  if (selectedHexActiveExpansion) return '#0284c7';
  if (selectedExpansion.canExpand) return '#f59e0b';
  if (selectedExpansion.isAdjacent && selectedExpansion.influence.withinReach) {
    return '#ea580c';
  }
  return '#94a3b8';
}

const GameHud = memo(function GameHud({
  gameState,
  turn,
  worldSeed,
  cash,
  territoryCount,
  territorySummary,
  resources,
  economy,
  cities,
  stage,
  unlockedTechs,
  activeEvent,
  activeEffects,
  autoTurnEnabled,
  commandModeActive,
  selectedIndex,
  toolMode,
  selectedHex,
  selectedHexOwned,
  selectedHexHasConstruction,
  selectedHexConstruction,
  selectedHexActiveExpansion,
  selectedTileAssetName,
  selectedExpansion,
  selectedTerrainInfo,
  selectedStrategicInfo,
  selectedHexUnit,
  selectedHexFaction,
  selectedBuildingReport,
  selectedCity,
  selectedRoad,
  selectedRoadCheck,
  contextualBuild,
  canBuildActiveOnSelected: _canBuildActiveOnSelected,
  activeBuildEffectiveCost,
  assets,
  muted,
  dockOpen,
  buildSheetOpen,
  toastMessage,
  onStartGame,
  onResume,
  onPause,
  onBackToTitle,
  onResetStarter,
  onNewProceduralWorld,
  onClearMap,
  onAdvanceTurn,
  onToggleAutoTurn,
  onOpenKingdomModal,
  onSelectPiece: _onSelectPiece,
  onBuildOptionOnSelected,
  onCyclePiece,
  onRotatePiece,
  onSetToolMode,
  onConfirmSelectedHex,
  onBuildRoadSelected,
  onDemolishSelectedHex,
  onRecruitUnit,
  onStartUnitCommand,
  onCancelAction,
  onSaveMap,
  onLoadMap,
  onToggleMute,
  onToggleDock,
  onSetBuildSheetOpen,
  onCenterCamera,
  onZoom,
  onRotateCamera,
}: GameHudProps) {
  void _canBuildActiveOnSelected;
  void _onSelectPiece;

  const activeAsset = assets[selectedIndex] ?? assets[0];
  const activePieceDef = getBuildingDefinition(activeAsset.name);
  const activePieceInfo = getStructureDisplayInfo(activeAsset.name);
  const activePieceLabel =
    activePieceDef.labelPt || activePieceInfo.labelPt || formatHexDisplayName(activeAsset.name);
  const activeTechLocked =
    activePieceDef.requiredTech !== null &&
    !unlockedTechs.includes(activePieceDef.requiredTech);

  const hasCancellableState =
    selectedHex !== null ||
    toolMode === 'demolish' ||
    toolMode === 'road' ||
    toolMode === 'command' ||
    buildSheetOpen;

  const roadButtonLabel = useMemo(() => {
    if (selectedRoad && selectedRoad.level >= 5) {
      return 'Via Comercial (Máx.)';
    }
    const def = selectedRoadCheck?.definition;
    if (!def) return 'Estrada';
    return `${selectedRoadCheck.isUpgrade ? 'Melhorar' : 'Estrada'}: ${def.shortNamePt} (${formatCompactCost(def.cost, def.cost.gold)})`;
  }, [selectedRoad, selectedRoadCheck]);

  const selectedBuildingDef = selectedTileAssetName
    ? getBuildingDefinition(selectedTileAssetName)
    : null;
  const canRecruitHere = Boolean(
    selectedHexOwned &&
      selectedHexHasConstruction &&
      !selectedHexConstruction &&
      selectedBuildingDef?.canRecruitUnits &&
      !selectedHexUnit
  );
  const recruitOptions: UnitType[] = useMemo(() => {
    if (!canRecruitHere || !selectedTileAssetName) return [];
    if (selectedTileAssetName === 'building-port') return ['warship'];
    if (selectedTileAssetName === 'unit-wall-tower') return ['knight', 'infantry'];
    return ['infantry', 'archer', 'knight'];
  }, [canRecruitHere, selectedTileAssetName]);

  const selectedBuildingLabel =
    selectedHexHasConstruction && selectedTileAssetName
      ? selectedBuildingDef?.labelPt ||
        getStructureDisplayInfo(selectedTileAssetName).labelPt ||
        formatHexDisplayName(selectedTileAssetName)
      : 'Terreno livre';

  const strategicBonusLine = useMemo(() => {
    if (!selectedStrategicInfo || !selectedStrategicInfo.labelPt) return null;
    const mods: string[] = [];
    if (selectedStrategicInfo.bonusGoldPerTurn > 0)
      mods.push(`+${selectedStrategicInfo.bonusGoldPerTurn} Ouro/t`);
    if (selectedStrategicInfo.bonusSciencePerTurn > 0)
      mods.push(`+${selectedStrategicInfo.bonusSciencePerTurn} Ciência/t`);
    if (selectedStrategicInfo.bonusOrePerTurn > 0)
      mods.push(`+${selectedStrategicInfo.bonusOrePerTurn} Minério/t`);
    if (selectedStrategicInfo.bonusFoodPerTurn > 0)
      mods.push(`+${selectedStrategicInfo.bonusFoodPerTurn} Alimento/t`);
    return `${selectedStrategicInfo.labelPt}${mods.length ? ` (${mods.join(' · ')})` : ''}`;
  }, [selectedStrategicInfo]);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* TITLE SCREEN OVERLAY */}
      {gameState === 'title' && (
        <div
          className="absolute inset-0 flex flex-col justify-between"
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <div className="mt-auto md:my-auto w-full max-w-md pointer-events-auto">
            <div className="bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-2xl p-5 sm:p-7 shadow-[0_6px_0_#3c3426]">
              <div className="flex items-center gap-3.5">
                <svg
                  viewBox="0 0 56 56"
                  className="w-12 h-12 shrink-0"
                  aria-hidden="true"
                >
                  <polygon
                    points="28,3 50,15.5 50,40.5 28,53 6,40.5 6,15.5"
                    fill="#047857"
                    stroke="#2a2319"
                    strokeWidth="3"
                  />
                  <polygon
                    points="28,11 43,19.5 43,36.5 28,45 13,36.5 13,19.5"
                    fill="#34d399"
                    opacity="0.35"
                  />
                  <path
                    d="M28 15 L38 24 H34 V38 H22 V24 H18 Z"
                    fill="#fcf9f2"
                    stroke="#2a2319"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                  />
                  <rect x="25.5" y="29" width="5" height="9" fill="#d97706" />
                </svg>
                <div className="min-w-0">
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1f1a12] leading-none">
                    Hexagon World
                  </h1>
                  <p className="mt-1.5 text-xs font-medium text-[#5c5140]">
                    Estratégia Hexagonal, Cidade e Conquista 3D
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5">
                <button
                  type="button"
                  data-start="true"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onStartGame();
                  }}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 text-white font-display text-sm font-bold border-2 border-[#1e2d24] shadow-[0_4px_0_#1e2d24] hover:bg-emerald-800 active:translate-y-0.5 transition-all whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  Jogar Agora
                </button>
              </div>
            </div>
          </div>

          <div className="pt-3 text-center">
            <p className="md:hidden inline-block text-[11px] font-semibold text-[#1f2933] drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]">
              Arraste para mover · Pinça para zoom · Toque nos hexágonos para construir, conquistar ou comandar
            </p>
            <p className="hidden md:inline-block text-xs font-semibold text-[#1f2933] drop-shadow-[0_1px_0_rgba(255,255,255,0.85)]">
              Gerencie recursos, pesquisas, tropas e facções · Espaço avança o turno · Arraste ou WASD move o mapa
            </p>
          </div>
        </div>
      )}

      {/* PLAYING HUD */}
      {gameState === 'playing' && (
        <>
          {/* TOP BAR */}
          <div
            className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 pointer-events-none"
            style={{
              paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
              paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
              paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
            }}
          >
            {/* Top-Left Compact Economy & Kingdom Plaque */}
            <div className="pointer-events-auto flex flex-col items-start gap-1.5 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-xl px-2.5 py-1.5 sm:px-3.5 sm:py-2 shadow-[0_3px_0_#3c3426]">
                <div className="flex items-center gap-1.5 pr-2 sm:pr-2.5 border-r border-[#d9ceb8]">
                  <Coins className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                      Saldo
                    </p>
                    <p
                      data-testid="hud-cash"
                      className="font-display text-sm sm:text-base font-bold text-[#1f1a12] tabular-nums leading-tight"
                    >
                      {formatCash(cash)}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenKingdomModal('economy')}
                  title="Ver Capacidade Territorial e Expansão"
                  className="flex items-center gap-1.5 sm:pr-2.5 sm:border-r sm:border-[#d9ceb8] text-left cursor-pointer hover:opacity-80"
                >
                  <Flag className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                      Território
                    </p>
                    <p
                      data-testid="hud-territory"
                      className="font-display text-sm sm:text-base font-bold text-[#1f1a12] tabular-nums leading-tight"
                    >
                      {territoryCount}/{territorySummary.capacity}
                      {territorySummary.inProgress > 0 && (
                        <span className="ml-1 text-[10px] text-sky-700">
                          +{territorySummary.inProgress}
                        </span>
                      )}
                    </p>
                  </div>
                </button>

                <div className="hidden sm:flex items-center gap-1.5">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                      {stage.labelPt} · {cities.length} {cities.length === 1 ? 'cid' : 'cids'}
                    </p>
                    <p
                      data-testid="hud-turn"
                      className="font-display text-sm sm:text-base font-bold text-[#1f1a12] tabular-nums leading-tight"
                    >
                      T{turn}
                    </p>
                  </div>
                </div>
              </div>

              {/* Compact Population & Resource Stockpile Bar (tapping opens Economy tab) */}
              <button
                type="button"
                data-testid="hud-resources"
                onClick={() => onOpenKingdomModal('economy')}
                title="Abrir Economia do Reino"
                className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-[#fcf9f2]/95 border-2 border-[#3c3426] rounded-xl px-2.5 py-1 shadow-[0_2px_0_#3c3426] text-[11px] font-bold text-[#2a2319] tabular-nums hover:bg-white cursor-pointer max-w-[calc(100vw-1.5rem)]"
              >
                <span
                  className="inline-flex items-center gap-1 pr-2 border-r border-[#d9ceb8]"
                  title="População e trabalhadores livres"
                >
                  <Users className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                  <span data-testid="hud-population">
                    {economy.population.current}/{economy.population.capacity}
                  </span>
                  <span
                    data-testid="hud-workers-free"
                    className={`ml-0.5 text-[10px] ${
                      economy.population.buildingWorkersAssigned <
                      economy.population.buildingWorkersRequired
                        ? 'text-rose-700'
                        : 'text-emerald-800'
                    }`}
                  >
                    ({economy.population.availableWorkers} liv)
                  </span>
                </span>
                <span className="inline-flex items-center gap-1" title="Madeira">
                  <Trees className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                  <span data-testid="res-wood">{resources.wood}</span>
                </span>
                <span className="inline-flex items-center gap-1" title="Pedra">
                  <Mountain className="w-3.5 h-3.5 text-slate-600 shrink-0" aria-hidden="true" />
                  <span data-testid="res-stone">{resources.stone}</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 ${
                    economy.population.hasFoodDeficit
                      ? 'text-rose-700'
                      : economy.foodNet < 0
                        ? 'text-amber-800'
                        : ''
                  }`}
                  title="Alimento"
                >
                  <Wheat className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                  <span data-testid="res-food">{resources.food}</span>
                </span>
                <span className="inline-flex items-center gap-1" title="Minério">
                  <Pickaxe className="w-3.5 h-3.5 text-slate-700 shrink-0" aria-hidden="true" />
                  <span data-testid="res-ore">{resources.ore}</span>
                </span>
                <span className="inline-flex items-center gap-1" title="Metal">
                  <Flame className="w-3.5 h-3.5 text-orange-700 shrink-0" aria-hidden="true" />
                  <span data-testid="res-metal">{resources.metal}</span>
                </span>
                <span className="inline-flex items-center gap-1" title="Ciência por turno">
                  <FlaskConical className="w-3.5 h-3.5 text-sky-700 shrink-0" aria-hidden="true" />
                  <span data-testid="res-science">+{economy.scienceNet}</span>
                </span>
              </button>

              {activeEffects.length > 0 && (
                <button
                  type="button"
                  data-testid="hud-active-effect-badge"
                  onClick={() => onOpenKingdomModal('economy')}
                  className="inline-flex items-center gap-1.5 bg-amber-100 border-2 border-amber-600 rounded-lg px-2 py-1 text-[11px] font-bold text-amber-950 shadow-[0_2px_0_#92400e] cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
                  <span>
                    {activeEffects[0].titlePt} ({activeEffects[0].turnsRemaining}t)
                  </span>
                </button>
              )}
            </div>

            {/* Top-Right: Turn Advance + Kingdom Drawer + Utility */}
            <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-testid="advance-turn-button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onAdvanceTurn();
                }}
                title="Avançar Turno (Espaço)"
                className="min-h-[42px] px-3 rounded-xl bg-emerald-700 border-2 border-[#1e2d24] text-white font-display text-xs font-bold shadow-[0_3px_0_#1e2d24] hover:bg-emerald-800 active:translate-y-0.5 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <FastForward className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Turno +1</span>
                <span className="sm:hidden">T{turn} +</span>
              </button>

              <button
                type="button"
                data-testid="open-kingdom-button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onOpenKingdomModal(activeEvent ? 'diplomacy' : 'economy');
                }}
                title="Painel do Reino (Economia, Pesquisa, Exército, Facções)"
                className="relative min-h-[42px] px-3 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#1f1a12] font-display text-xs font-bold shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Crown className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">Reino</span>
                {activeEvent && (
                  <span
                    aria-label="Evento pendente"
                    className="ml-0.5 px-1.5 py-0.5 rounded bg-amber-500 text-[#1f1a12] text-[10px] leading-none font-bold"
                  >
                    !
                  </span>
                )}
              </button>

              {/* Mobile Menu Button */}
              <button
                type="button"
                data-testid="mobile-menu-button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPause();
                }}
                aria-label="Abrir menu e opções"
                className="md:hidden w-11 h-11 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] active:bg-white flex items-center justify-center cursor-pointer"
              >
                <Menu className="w-5 h-5" aria-hidden="true" />
              </button>

              {/* Desktop Utility Strip */}
              <div className="hidden md:flex items-center gap-1.5">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onSaveMap();
                  }}
                  aria-label="Salvar reino (F1)"
                  title="Salvar reino (F1)"
                  className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onLoadMap();
                  }}
                  aria-label="Carregar reino (F2)"
                  title="Carregar reino (F2)"
                  className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onToggleMute();
                  }}
                  aria-label={muted ? 'Ativar som (M)' : 'Silenciar som (M)'}
                  title={muted ? 'Ativar som (M)' : 'Silenciar som (M)'}
                  className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
                >
                  {muted ? (
                    <VolumeX className="w-4 h-4 text-rose-700" aria-hidden="true" />
                  ) : (
                    <Volume2 className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onPause();
                  }}
                  aria-label="Pausar jogo (Esc ou P)"
                  title="Pausar (Esc / P)"
                  className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
                >
                  <Pause className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Ephemeral Toast Feedback */}
          {toastMessage && (
            <div
              role="status"
              aria-live="polite"
              style={{
                top: 'calc(max(0.75rem, env(safe-area-inset-top)) + 5.75rem)',
              }}
              className="absolute left-1/2 -translate-x-1/2 z-30 bg-[#1f2923] text-[#fcf9f2] border-2 border-[#3c3426] rounded-xl px-4 py-2 text-xs font-semibold shadow-md whitespace-nowrap max-w-[92vw] truncate"
            >
              {toastMessage}
            </div>
          )}

          {/* Command Mode Banner (Desktop & Mobile) */}
          {commandModeActive && (
            <div
              style={{
                top: 'calc(max(0.75rem, env(safe-area-inset-top)) + 5.75rem)',
              }}
              className="pointer-events-auto absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-emerald-800 text-white border-2 border-[#1e2d24] rounded-xl px-3.5 py-2 text-xs font-semibold shadow-md max-w-[94vw]"
            >
              <Swords className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                Toque em um hexágono vizinho destacado para mover ou atacar
              </span>
              <button
                type="button"
                onClick={onCancelAction}
                className="px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[11px] font-bold whitespace-nowrap cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          )}

          {/* ========================================================= */}
          {/* MOBILE PLAYING HUD (< md)                                 */}
          {/* ========================================================= */}
          <div
            className="md:hidden fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 pointer-events-none"
            style={{
              paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
              paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
              paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
            }}
          >
            {/* Contextual Selected-Hex Card */}
            {selectedHex && !buildSheetOpen && selectedExpansion && toolMode !== 'command' && (
              <div
                data-testid="mobile-selection-bar"
                className="pointer-events-auto w-full max-w-md bg-[#fcf9f2]/98 border-2 border-[#3c3426] rounded-2xl p-2.5 shadow-[0_4px_0_#3c3426] space-y-2"
              >
                <div className="flex items-start justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: getExpansionDotColor(
                            selectedHexFaction,
                            selectedExpansion,
                            selectedHexActiveExpansion
                          ),
                        }}
                      />
                      <p className="text-xs font-bold text-[#1f1a12] truncate">
                        {selectedBuildingLabel}
                      </p>
                      {selectedBuildingReport && !selectedHexConstruction && (
                        <span
                          data-testid="mobile-building-status"
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold leading-none ${
                            selectedBuildingReport.status === 'operating'
                              ? 'bg-emerald-100 text-emerald-900'
                              : selectedBuildingReport.status === 'partial'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-rose-100 text-rose-900'
                          }`}
                        >
                          {selectedBuildingReport.statusLabelPt}
                        </span>
                      )}
                      {selectedRoad && (
                        <span
                          data-testid="mobile-road-badge"
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none bg-[#efe8d8] text-[#3c3426] border border-[#c8ba9f]"
                        >
                          {ROAD_CATALOG[selectedRoad.level].namePt}
                        </span>
                      )}
                      {selectedBuildingReport?.districtLabelPt && !selectedHexConstruction && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none bg-sky-100 text-sky-900">
                          {selectedBuildingReport.districtLabelPt}
                        </span>
                      )}
                    </div>

                    {selectedCity && (
                      <div
                        data-testid="mobile-city-info"
                        className="mt-1 bg-[#f7f2e6] border border-[#d9ceb8] rounded-lg px-2 py-1 text-[11px]"
                      >
                        <p className="font-bold text-[#1f1a12] flex items-center gap-1 truncate">
                          <Building2 className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
                          <span>
                            {selectedCity.name} · {selectedCity.stageLabelPt} ({selectedCity.level}/5)
                          </span>
                        </p>
                        <p className="text-[10px] font-semibold text-[#5c5140] tabular-nums truncate">
                          Pop. local ~{selectedCity.localPopulation} ·{' '}
                          {selectedCity.connectedCityIds.length > 0
                            ? `${selectedCity.connectedCityIds.length} conexão(ões)`
                            : selectedCity.stabilityLabelPt}
                          {selectedCity.nextLevelScore !== null
                            ? ` · Evol. ${selectedCity.developmentScore}/${selectedCity.nextLevelScore}`
                            : ' · Estágio Máx.'}
                        </p>
                        {selectedCity.specializations.length > 0 && (
                          <p className="text-[10px] font-bold text-emerald-800 truncate">
                            {selectedCity.specializations.map((s) => s.labelPt).join(' · ')}
                          </p>
                        )}
                      </div>
                    )}

                    {selectedHexConstruction ? (
                      <p
                        data-testid="mobile-construction-status"
                        className="text-[11px] font-bold text-amber-800 mt-0.5"
                      >
                        Em construção (faltam {selectedHexConstruction.turnsRemaining}/
                        {selectedHexConstruction.totalTurns} turnos)
                      </p>
                    ) : selectedHexHasConstruction && selectedBuildingDef ? (
                      selectedBuildingReport ? (
                        <div className="mt-0.5 space-y-0.5">
                          <p className="text-[11px] font-medium text-[#2a2319]">
                            {formatLiveBuildingYield(selectedBuildingReport, selectedBuildingDef)}
                          </p>
                          {(selectedBuildingReport.workersRequired > 0 ||
                            selectedBuildingReport.locationEfficiencyPct !== 100 ||
                            selectedBuildingReport.logisticsEfficiencyPct !== 100) && (
                            <p className="text-[10px] font-semibold text-[#5c5140] tabular-nums">
                              {selectedBuildingReport.workersRequired > 0
                                ? `Trab.: ${selectedBuildingReport.workersAssigned}/${selectedBuildingReport.workersRequired}`
                                : ''}
                              {selectedBuildingReport.workersRequired > 0 &&
                              (selectedBuildingReport.locationEfficiencyPct !== 100 ||
                                selectedBuildingReport.logisticsEfficiencyPct !== 100)
                                ? ' · '
                                : ''}
                              {selectedBuildingReport.locationEfficiencyPct !== 100
                                ? `Local: ${selectedBuildingReport.locationEfficiencyPct}%`
                                : ''}
                              {selectedBuildingReport.locationEfficiencyPct !== 100 &&
                              selectedBuildingReport.logisticsEfficiencyPct !== 100
                                ? ' · '
                                : ''}
                              {selectedBuildingReport.logisticsEfficiencyPct !== 100
                                ? `Logística: ${selectedBuildingReport.logisticsEfficiencyPct}% (${selectedBuildingReport.logisticsStatusPt})`
                                : ''}
                            </p>
                          )}
                          {selectedBuildingReport.reasonPt && (
                            <p className="text-[11px] font-bold text-rose-700">
                              {selectedBuildingReport.reasonPt}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] font-medium text-[#3c3426] mt-0.5">
                          {selectedBuildingDef.summaryPt}
                        </p>
                      )
                    ) : null}

                    {selectedTerrainInfo && (
                      <p
                        data-testid="mobile-terrain-info"
                        className="text-[11px] font-semibold text-[#1f2923] mt-0.5"
                      >
                        Terreno: {selectedTerrainInfo.labelPt} ·{' '}
                        {selectedHexHasConstruction
                          ? `Recurso: ${selectedTerrainInfo.resourceLabelPt}`
                          : `Potencial: ${selectedTerrainInfo.potentialPt}`}
                      </p>
                    )}

                    {strategicBonusLine && (
                      <p className="text-[11px] font-bold text-amber-800 mt-0.5">
                        Região rara: {strategicBonusLine}
                      </p>
                    )}

                    {selectedHexUnit && (
                      <p className="text-[11px] font-bold text-emerald-900 mt-0.5">
                        Unidade: {UNIT_CATALOG[selectedHexUnit.type].namePt} · HP{' '}
                        {selectedHexUnit.hp}/{selectedHexUnit.maxHp}
                      </p>
                    )}

                    {selectedExpansion.owner === 'neutral' && !selectedHexActiveExpansion && (
                      <p
                        data-testid="mobile-influence-info"
                        className="text-[11px] font-semibold text-[#3c3426] mt-0.5 tabular-nums"
                      >
                        Influência {selectedExpansion.influence.score}/
                        {selectedExpansion.influence.requiredInfluence} · Alcance{' '}
                        {Number.isFinite(selectedExpansion.influence.minDistToAnchor)
                          ? selectedExpansion.influence.minDistToAnchor
                          : '-'}
                        /{selectedExpansion.influence.maxAnchorReach}
                      </p>
                    )}

                    <p className="text-[11px] font-medium text-[#5c5140] mt-0.5">
                      {selectedExpansion.owner === 'player'
                        ? selectedHexConstruction
                          ? 'Obra em andamento · Aguardando conclusão'
                          : selectedHexHasConstruction
                            ? 'Seu território · Possui construção'
                            : contextualBuild && contextualBuild.options.length > 0
                              ? `Seu território · ${contextualBuild.options.length} obra(s) compatível(is)`
                              : 'Seu território · Livre para construir'
                        : selectedHexFaction
                          ? `${selectedHexFaction.namePt} (${
                              selectedHexFaction.relation === 'hostile'
                                ? 'Hostil'
                                : selectedHexFaction.relation === 'trade_pact'
                                  ? 'Comércio'
                                  : selectedHexFaction.relation === 'truce'
                                    ? 'Trégua'
                                    : 'Neutra'
                            })`
                          : selectedHexActiveExpansion
                            ? `Incorporando território (faltam ${selectedHexActiveExpansion.turnsRemaining}/${selectedHexActiveExpansion.totalTurns} turnos · ${selectedHexActiveExpansion.workersCommitted} trab.)`
                            : selectedExpansion.canExpand
                              ? `Pronto para incorporar (${selectedExpansion.turnsRequired} ${selectedExpansion.turnsRequired === 1 ? 'turno' : 'turnos'} · ${selectedExpansion.workersRequired} trab.)`
                              : getExpansionFailureMessage(selectedExpansion)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={onCancelAction}
                    aria-label="Fechar seleção"
                    className="w-10 h-10 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Inline Unit Command, Recruitment & Contextual Hex Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {selectedHexUnit &&
                    selectedHexUnit.owner === 'player' &&
                    !selectedHexUnit.movedThisTurn && (
                      <button
                        type="button"
                        data-testid="unit-command-button"
                        onClick={onStartUnitCommand}
                        className="flex-1 min-h-[44px] px-3 rounded-xl bg-emerald-700 text-white font-display text-xs font-bold border-2 border-[#1e2d24] flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <Swords className="w-4 h-4 shrink-0" aria-hidden="true" />
                        Mover / Atacar
                      </button>
                    )}

                  {recruitOptions.map((uType) => {
                    const uDef = UNIT_CATALOG[uType];
                    const locked =
                      uDef.requiredTech !== null &&
                      !unlockedTechs.includes(uDef.requiredTech);
                    return (
                      <button
                        key={uType}
                        type="button"
                        data-testid={`recruit-${uType}`}
                        onClick={() => onRecruitUnit(uType)}
                        className={`min-h-[44px] px-2.5 rounded-xl text-[11px] font-bold border whitespace-nowrap cursor-pointer ${
                          locked
                            ? 'bg-[#efe8d8] border-[#c8ba9f] text-[#6e604a]'
                            : 'bg-white border-[#3c3426] text-[#1f1a12] active:bg-[#f2ebdc]'
                        }`}
                      >
                        +{uDef.namePt} ({formatCash(uDef.cost.gold)})
                      </button>
                    );
                  })}

                  {selectedExpansion.owner === 'player' ? (
                    <>
                      {selectedHexHasConstruction ? (
                        <button
                          type="button"
                          data-testid="mobile-demolish-selected"
                          onClick={onDemolishSelectedHex}
                          className="flex-1 min-h-[46px] px-3 rounded-xl bg-rose-700 text-white font-display text-xs font-bold border-2 border-rose-950 shadow-[0_2px_0_#4c0519] flex items-center justify-center gap-1.5 cursor-pointer active:translate-y-0.5"
                        >
                          <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                          Demolir
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid="mobile-build-here-button"
                          onClick={() => {
                            onSetToolMode('build');
                            onSetBuildSheetOpen(true);
                          }}
                          className="flex-1 min-h-[46px] px-3 rounded-xl bg-emerald-700 text-white font-display text-xs font-bold border-2 border-[#1e2d24] shadow-[0_2px_0_#1e2d24] flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Hammer className="w-4 h-4 shrink-0" aria-hidden="true" />
                          Construir aqui
                        </button>
                      )}
                      {selectedRoadCheck && (!selectedRoad || selectedRoad.level < 5) && (
                        <button
                          type="button"
                          data-testid="mobile-build-road-selected"
                          onClick={onBuildRoadSelected}
                          className={`min-h-[46px] px-3 rounded-xl font-display text-xs font-bold border-2 flex items-center justify-center gap-1.5 cursor-pointer ${
                            selectedRoadCheck.allowed
                              ? 'bg-[#2a2319] text-[#fcf9f2] border-[#1f1a12]'
                              : 'bg-[#efe8d8] text-[#5c5140] border-[#bcae96]'
                          }`}
                        >
                          <Route className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span className="truncate max-w-[160px]">{roadButtonLabel}</span>
                        </button>
                      )}
                    </>
                  ) : selectedExpansion.owner !== 'neutral' ? (
                    <button
                      type="button"
                      onClick={() => onOpenKingdomModal('diplomacy')}
                      className="flex-1 min-h-[46px] px-3 rounded-xl bg-[#efe8d8] text-[#2a2319] font-display text-xs font-semibold border-2 border-[#c8ba9f] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Swords className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Diplomacia / Guerra
                    </button>
                  ) : selectedHexActiveExpansion ? (
                    <div
                      data-testid="mobile-expanding-status"
                      className="flex-1 min-h-[46px] px-3 rounded-xl bg-sky-100 text-sky-900 font-display text-xs font-bold border-2 border-sky-400 flex items-center justify-center gap-1.5"
                    >
                      <Flag className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Incorporando ({selectedHexActiveExpansion.turnsRemaining}/
                      {selectedHexActiveExpansion.totalTurns}t)
                    </div>
                  ) : selectedExpansion.isAdjacent ? (
                    <button
                      type="button"
                      data-testid="mobile-conquer-button"
                      onClick={onConfirmSelectedHex}
                      className={`flex-1 min-h-[46px] px-3 rounded-xl font-display text-xs font-bold border-2 flex items-center justify-center gap-1.5 cursor-pointer active:translate-y-0.5 ${
                        selectedExpansion.canExpand
                          ? 'bg-amber-500 text-[#1f1a12] border-[#3c3426] shadow-[0_2px_0_#3c3426]'
                          : 'bg-[#efe8d8] text-[#6e604a] border-[#bcae96]'
                      }`}
                    >
                      <Flag className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {getExpansionButtonLabel(selectedExpansion)}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="mobile-conquer-blocked"
                      onClick={onConfirmSelectedHex}
                      className="flex-1 min-h-[46px] px-3 rounded-xl bg-[#efe8d8] text-[#5c5140] font-display text-xs font-semibold border-2 border-[#c8ba9f] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {getExpansionButtonLabel(selectedExpansion)}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Road Active Indicator Banner */}
            {toolMode === 'road' && !buildSheetOpen && (
              <div className="pointer-events-auto flex items-center gap-2 bg-[#2a2319] text-[#fcf9f2] border-2 border-[#3c3426] rounded-xl px-3.5 py-1.5 text-xs font-semibold shadow-sm">
                <Route className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                <span>Toque em um hexágono seu para construir ou melhorar estrada</span>
              </div>
            )}

            {/* Demolish Active Indicator Banner */}
            {toolMode === 'demolish' && !buildSheetOpen && (
              <div className="pointer-events-auto flex items-center gap-2 bg-rose-700 text-white border-2 border-rose-950 rounded-xl px-3.5 py-1.5 text-xs font-semibold shadow-sm">
                <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Toque em um hexágono para demolir</span>
              </div>
            )}

            {/* Primary Mobile Thumb Dock */}
            {!buildSheetOpen && (
              <div className="pointer-events-auto w-full max-w-md bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-2xl p-1.5 shadow-[0_4px_0_#3c3426] flex items-stretch gap-1">
                <button
                  type="button"
                  data-testid="mobile-expand-button"
                  onClick={() => onSetToolMode('expand')}
                  aria-pressed={toolMode === 'expand'}
                  className={`flex-1 min-w-0 min-h-[52px] px-1.5 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                    toolMode === 'expand'
                      ? 'bg-amber-500 border-[#3c3426] text-[#1f1a12] shadow-[0_2px_0_#3c3426]'
                      : 'bg-white border-[#c8ba9f] text-[#2a2319]'
                  }`}
                >
                  <Flag className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="text-[10px] font-bold leading-none truncate">Expandir</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-build-button"
                  onClick={() => {
                    onSetToolMode('build');
                    onSetBuildSheetOpen(true);
                  }}
                  aria-pressed={toolMode === 'build'}
                  title={`Construir: ${activePieceLabel}`}
                  className={`flex-1 min-w-0 min-h-[52px] px-1 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                    toolMode === 'build'
                      ? 'bg-emerald-700 border-[#1e2d24] text-white shadow-[0_2px_0_#1e2d24]'
                      : 'bg-white border-[#c8ba9f] text-[#2a2319]'
                  }`}
                >
                  <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="max-w-full text-[10px] font-bold leading-none truncate">
                    Construir
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-road-button"
                  onClick={() =>
                    onSetToolMode(toolMode === 'road' ? 'expand' : 'road')
                  }
                  aria-pressed={toolMode === 'road'}
                  className={`flex-1 min-w-0 min-h-[52px] px-1.5 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                    toolMode === 'road'
                      ? 'bg-[#2a2319] border-[#1f1a12] text-[#fcf9f2]'
                      : 'bg-white border-[#c8ba9f] text-[#2a2319]'
                  }`}
                >
                  <Route className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="text-[10px] font-bold leading-none truncate">Estrada</span>
                </button>

                <button
                  type="button"
                  data-testid="mobile-demolish-button"
                  onClick={() =>
                    onSetToolMode(toolMode === 'demolish' ? 'expand' : 'demolish')
                  }
                  aria-label="Alternar modo demolir"
                  aria-pressed={toolMode === 'demolish'}
                  className={`flex-1 min-w-0 min-h-[52px] px-1.5 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                    toolMode === 'demolish'
                      ? 'bg-rose-700 border-rose-950 text-white'
                      : 'bg-white border-[#3c3426] text-[#2a2319] active:bg-[#f2ebdc]'
                  }`}
                >
                  <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="text-[10px] font-bold leading-none truncate">Demolir</span>
                </button>

                {hasCancellableState ? (
                  <button
                    type="button"
                    data-testid="mobile-cancel-button"
                    onClick={onCancelAction}
                    aria-label="Cancelar ação atual"
                    className="flex-1 min-w-0 min-h-[52px] px-1.5 rounded-xl bg-[#efe8d8] border-2 border-[#3c3426] text-[#1f1a12] active:bg-[#e5dcc7] flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <X className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="text-[10px] font-bold leading-none truncate">Cancelar</span>
                  </button>
                ) : toolMode === 'build' ? (
                  <button
                    type="button"
                    data-testid="mobile-rotate-button"
                    onClick={onRotatePiece}
                    aria-label="Girar peça"
                    className="flex-1 min-w-0 min-h-[52px] px-1.5 rounded-xl bg-white border-2 border-[#3c3426] text-[#2a2319] active:bg-[#f2ebdc] flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <RotateCw className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="text-[10px] font-bold leading-none truncate">Girar</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="mobile-save-button"
                    onClick={onSaveMap}
                    aria-label="Salvar reino"
                    className="flex-1 min-w-0 min-h-[52px] px-1.5 rounded-xl bg-white border-2 border-[#3c3426] text-[#2a2319] active:bg-[#f2ebdc] flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <Save className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="text-[10px] font-bold leading-none truncate">Salvar</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Mobile Contextual Build Bottom Sheet ("O que posso construir neste hex?") */}
          {buildSheetOpen && (
            <div className="md:hidden fixed inset-0 z-30 flex flex-col justify-end pointer-events-auto">
              <button
                type="button"
                aria-label="Fechar painel de construção"
                onClick={() => onSetBuildSheetOpen(false)}
                className="flex-1 w-full bg-[#1a221d]/25 cursor-default"
              />

              <div
                data-testid="mobile-build-sheet"
                className="w-full max-h-[56dvh] flex flex-col bg-[#fcf9f2] border-t-2 border-x-2 border-[#3c3426] rounded-t-3xl shadow-[0_-8px_24px_rgba(31,26,18,0.2)]"
                style={{
                  paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
                  paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
                  paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
                }}
              >
                <div className="pt-2.5 pb-2 px-1 flex items-center justify-between gap-2 border-b border-[#e0d6c3]">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-bold text-[#1f1a12]">
                      {selectedHex && contextualBuild
                        ? 'O que posso construir neste hex?'
                        : 'Construção Contextual'}
                    </p>
                    <p className="text-[11px] text-[#5c5140] truncate">
                      {selectedHex && contextualBuild
                        ? `Terreno: ${contextualBuild.terrain.labelPt} · Recurso: ${contextualBuild.terrain.resourceLabelPt}`
                        : 'Toque em um hexágono livre do seu território no mapa'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={onRotatePiece}
                      aria-label="Girar orientação da obra"
                      className="min-h-[44px] px-3 rounded-xl bg-white border border-[#c8ba9f] text-[#2a2319] text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCw className="w-4 h-4" aria-hidden="true" />
                      <span>Girar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSetBuildSheetOpen(false)}
                      aria-label="Fechar painel de construção"
                      className="w-11 h-11 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto hex-touch-scroll pt-2.5 pb-1 space-y-2">
                  {!selectedHex || !contextualBuild ? (
                    <div className="bg-white border-2 border-[#d9ceb8] rounded-2xl p-4 text-center space-y-2">
                      <p className="text-xs font-semibold text-[#2a2319]">
                        Toque em um hexágono livre pertencente ao seu território para ver exatamente quais obras podem ser erguidas ali.
                      </p>
                      <button
                        type="button"
                        onClick={() => onSetBuildSheetOpen(false)}
                        className="min-h-[44px] px-4 rounded-xl bg-emerald-700 text-white font-display text-xs font-bold border-2 border-[#1e2d24] cursor-pointer"
                      >
                        Escolher hex no mapa
                      </button>
                    </div>
                  ) : contextualBuild.options.length === 0 ? (
                    <div
                      data-testid="mobile-build-empty"
                      className="bg-[#f4efe4] border-2 border-[#d9ceb8] rounded-2xl p-4 space-y-1"
                    >
                      <p className="text-xs font-bold text-[#1f1a12]">
                        Nenhuma obra disponível neste hex
                      </p>
                      <p className="text-xs font-medium text-[#5c5140]">
                        {contextualBuild.blockedReasonPt ??
                          contextualBuild.hintPt ??
                          'Não há construções compatíveis desbloqueadas para este terreno.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {contextualBuild.options.map((opt) => {
                          const isSelected = opt.assetIndex === selectedIndex;
                          const asset = assets[opt.assetIndex];
                          return (
                            <button
                              key={opt.assetName}
                              type="button"
                              data-testid={`mobile-piece-${opt.assetName}`}
                              onClick={() => onBuildOptionOnSelected(opt.assetIndex)}
                              className={`min-h-[68px] px-3 py-2 rounded-xl border-2 text-left transition-colors cursor-pointer ${
                                !opt.affordable
                                  ? 'bg-[#f4efe4] border-[#d9ceb8] text-[#5c5140]'
                                  : isSelected
                                    ? 'bg-emerald-700 border-[#1e2d24] text-white'
                                    : 'bg-white border-[#3c3426] text-[#1f1a12] active:bg-[#f5efe1]'
                              }`}
                            >
                              <span className="block text-xs font-bold leading-tight truncate">
                                {opt.definition.labelPt}
                              </span>
                              <span
                                className={`mt-0.5 block text-[10px] font-medium truncate ${
                                  isSelected && opt.affordable
                                    ? 'text-emerald-100'
                                    : 'text-[#5c5140]'
                                }`}
                              >
                                {opt.definition.summaryPt}
                              </span>
                              <span
                                className={`mt-1 block text-[10px] font-bold tabular-nums truncate ${
                                  !opt.affordable
                                    ? 'text-rose-700'
                                    : isSelected
                                      ? 'text-white'
                                      : 'text-emerald-800'
                                }`}
                              >
                                {`${formatCompactCost(opt.effectiveCost, asset?.price ?? 0)} · ${opt.definition.buildTimeTurns}t`}
                              </span>
                              {opt.workerWarningPt && (
                                <span className="mt-0.5 block text-[9px] font-bold text-amber-700 truncate">
                                  {opt.workerWarningPt}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {contextualBuild.hintPt && (
                        <p className="px-1 text-[11px] font-medium text-[#5c5140]">
                          {contextualBuild.hintPt}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* DESKTOP PLAYING HUD (md+)                                 */}
          {/* ========================================================= */}
          <div className="hidden md:flex absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(960px,95vw)] flex-col items-center pointer-events-none">
            {/* Desktop Contextual Selection Card */}
            {toolMode !== 'command' && selectedHex && selectedExpansion && (
              <div
                data-testid="desktop-selection-bar"
                className="pointer-events-auto mb-2 flex flex-wrap items-center gap-3 bg-[#fcf9f2]/98 border-2 border-[#3c3426] rounded-2xl px-4 py-2.5 shadow-[0_4px_0_#3c3426] max-w-full"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: getExpansionDotColor(
                          selectedHexFaction,
                          selectedExpansion,
                          selectedHexActiveExpansion
                        ),
                      }}
                    />
                    <p className="text-xs font-bold text-[#1f1a12]">
                      {selectedBuildingLabel}
                    </p>
                    {selectedBuildingReport && !selectedHexConstruction && (
                      <span
                        data-testid="desktop-building-status"
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold leading-none ${
                          selectedBuildingReport.status === 'operating'
                            ? 'bg-emerald-100 text-emerald-900'
                            : selectedBuildingReport.status === 'partial'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-rose-100 text-rose-900'
                        }`}
                      >
                        {selectedBuildingReport.statusLabelPt}
                      </span>
                    )}
                    {selectedRoad && (
                      <span
                        data-testid="desktop-road-badge"
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none bg-[#efe8d8] text-[#3c3426] border border-[#c8ba9f]"
                      >
                        {ROAD_CATALOG[selectedRoad.level].namePt}
                      </span>
                    )}
                    {selectedBuildingReport?.districtLabelPt && !selectedHexConstruction && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold leading-none bg-sky-100 text-sky-900">
                        {selectedBuildingReport.districtLabelPt}
                      </span>
                    )}
                    {selectedHexConstruction ? (
                      <span
                        data-testid="desktop-construction-status"
                        className="text-[11px] font-bold text-amber-800"
                      >
                        · Em construção (faltam {selectedHexConstruction.turnsRemaining}/
                        {selectedHexConstruction.totalTurns} turnos)
                      </span>
                    ) : selectedHexHasConstruction && selectedBuildingDef ? (
                      <span className="text-[11px] font-medium text-[#5c5140]">
                        ·{' '}
                        {selectedBuildingReport
                          ? formatLiveBuildingYield(selectedBuildingReport, selectedBuildingDef)
                          : selectedBuildingDef.summaryPt}
                      </span>
                    ) : null}
                  </div>

                  {selectedCity && (
                    <div
                      data-testid="desktop-city-info"
                      className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] bg-[#f7f2e6] border border-[#d9ceb8] rounded-lg px-2.5 py-1"
                    >
                      <span className="font-bold text-[#1f1a12] inline-flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
                        {selectedCity.name} · {selectedCity.stageLabelPt} ({selectedCity.level}/5)
                      </span>
                      <span className="text-[#5c5140] tabular-nums">
                        Pop. local ~{selectedCity.localPopulation} ·{' '}
                        {selectedCity.connectedCityIds.length > 0
                          ? `${selectedCity.connectedCityIds.length} conexão(ões)`
                          : selectedCity.stabilityLabelPt}
                        {selectedCity.nextLevelScore !== null
                          ? ` · Evol. ${selectedCity.developmentScore}/${selectedCity.nextLevelScore}`
                          : ' · Estágio Máx.'}
                      </span>
                      {selectedCity.specializations.length > 0 && (
                        <span className="font-bold text-emerald-800">
                          {selectedCity.specializations.map((s) => s.labelPt).join(' · ')}
                        </span>
                      )}
                    </div>
                  )}

                  {selectedBuildingReport &&
                    !selectedHexConstruction &&
                    (selectedBuildingReport.workersRequired > 0 ||
                      selectedBuildingReport.locationEfficiencyPct !== 100 ||
                      selectedBuildingReport.logisticsEfficiencyPct !== 100 ||
                      selectedBuildingReport.reasonPt) && (
                      <p className="text-[11px] font-semibold text-[#5c5140] mt-0.5 tabular-nums">
                        {selectedBuildingReport.workersRequired > 0
                          ? `Trab.: ${selectedBuildingReport.workersAssigned}/${selectedBuildingReport.workersRequired}`
                          : ''}
                        {selectedBuildingReport.workersRequired > 0 &&
                        (selectedBuildingReport.locationEfficiencyPct !== 100 ||
                          selectedBuildingReport.logisticsEfficiencyPct !== 100)
                          ? ' · '
                          : ''}
                        {selectedBuildingReport.locationEfficiencyPct !== 100
                          ? `Eficiência local: ${selectedBuildingReport.locationEfficiencyPct}%`
                          : ''}
                        {selectedBuildingReport.locationBonusNotesPt.length > 0
                          ? ` (${selectedBuildingReport.locationBonusNotesPt[0]})`
                          : ''}
                        {selectedBuildingReport.logisticsEfficiencyPct !== 100
                          ? `${
                              selectedBuildingReport.workersRequired > 0 ||
                              selectedBuildingReport.locationEfficiencyPct !== 100
                                ? ' · '
                                : ''
                            }Logística: ${selectedBuildingReport.logisticsEfficiencyPct}% (${selectedBuildingReport.logisticsStatusPt})`
                          : ''}
                        {selectedBuildingReport.roadBonusNotesPt.length > 0
                          ? ` · ${selectedBuildingReport.roadBonusNotesPt[0]}`
                          : ''}
                        {selectedBuildingReport.reasonPt ? (
                          <span className="text-rose-700 font-bold">
                            {(selectedBuildingReport.workersRequired > 0 ||
                            selectedBuildingReport.locationEfficiencyPct !== 100 ||
                            selectedBuildingReport.logisticsEfficiencyPct !== 100
                              ? ' · '
                              : '') + selectedBuildingReport.reasonPt}
                          </span>
                        ) : null}
                      </p>
                    )}

                  {selectedTerrainInfo && (
                    <p
                      data-testid="desktop-terrain-info"
                      className="text-[11px] font-semibold text-[#1f2923] mt-0.5"
                    >
                      Terreno: {selectedTerrainInfo.labelPt} ·{' '}
                      {selectedHexHasConstruction
                        ? `Recurso: ${selectedTerrainInfo.resourceLabelPt}`
                        : `Potencial: ${selectedTerrainInfo.potentialPt}`}
                      {strategicBonusLine ? ` · ${strategicBonusLine}` : ''}
                    </p>
                  )}

                  {selectedHexUnit && (
                    <p className="text-[11px] font-bold text-emerald-900 mt-0.5">
                      Unidade: {UNIT_CATALOG[selectedHexUnit.type].namePt} · HP{' '}
                      {selectedHexUnit.hp}/{selectedHexUnit.maxHp}
                    </p>
                  )}

                  {selectedExpansion.owner === 'neutral' && !selectedHexActiveExpansion && (
                    <p
                      data-testid="desktop-influence-info"
                      className="text-[11px] font-semibold text-[#3c3426] mt-0.5 tabular-nums"
                    >
                      Influência {selectedExpansion.influence.score}/
                      {selectedExpansion.influence.requiredInfluence} · Alcance{' '}
                      {Number.isFinite(selectedExpansion.influence.minDistToAnchor)
                        ? selectedExpansion.influence.minDistToAnchor
                        : '-'}
                      /{selectedExpansion.influence.maxAnchorReach} · Capacidade{' '}
                      {selectedExpansion.capacitySummary.used}/
                      {selectedExpansion.capacitySummary.capacity}
                    </p>
                  )}

                  <p className="text-[11px] text-[#5c5140] mt-0.5">
                    {selectedExpansion.owner === 'player'
                      ? selectedHexConstruction
                        ? 'Obra em andamento · Produzirá após a conclusão.'
                        : selectedHexHasConstruction
                          ? 'Seu território · Já possui uma construção.'
                          : 'Seu território · Livre para construir.'
                      : selectedHexFaction
                        ? `${selectedHexFaction.namePt} · Relação: ${
                            selectedHexFaction.relation === 'hostile'
                              ? 'Hostil'
                              : selectedHexFaction.relation === 'trade_pact'
                                ? 'Comércio'
                                : selectedHexFaction.relation === 'truce'
                                  ? 'Trégua'
                                  : 'Neutra'
                          }`
                        : selectedHexActiveExpansion
                          ? `Incorporando território (faltam ${selectedHexActiveExpansion.turnsRemaining}/${selectedHexActiveExpansion.totalTurns} turnos · ${selectedHexActiveExpansion.workersCommitted} trab.)`
                          : selectedExpansion.canExpand
                            ? `Pronto para incorporar (${selectedExpansion.turnsRequired} ${selectedExpansion.turnsRequired === 1 ? 'turno' : 'turnos'} · ${selectedExpansion.workersRequired} trab.)`
                            : getExpansionFailureMessage(selectedExpansion)}
                  </p>
                </div>

                {/* Desktop Selection Action Strip */}
                <div className="w-full flex flex-wrap items-center gap-2 pt-0.5">
                  {/* Unit Command Button */}
                  {selectedHexUnit &&
                    selectedHexUnit.owner === 'player' &&
                    !selectedHexUnit.movedThisTurn && (
                      <button
                        type="button"
                        data-testid="unit-command-button"
                        onClick={onStartUnitCommand}
                        className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl font-display text-xs font-bold border-2 border-[#1e2d24] bg-emerald-700 text-white shadow-[0_2px_0_#1e2d24] hover:bg-emerald-800 whitespace-nowrap cursor-pointer"
                      >
                        <Swords className="w-3.5 h-3.5" aria-hidden="true" />
                        Mover / Atacar
                      </button>
                    )}

                  {/* Inline Recruit Buttons */}
                  {recruitOptions.map((uType) => {
                    const uDef = UNIT_CATALOG[uType];
                    const locked =
                      uDef.requiredTech !== null &&
                      !unlockedTechs.includes(uDef.requiredTech);
                    return (
                      <button
                        key={uType}
                        type="button"
                        data-testid={`recruit-${uType}`}
                        onClick={() => onRecruitUnit(uType)}
                        className={`inline-flex items-center gap-1 px-3 h-9 rounded-xl text-xs font-bold border whitespace-nowrap cursor-pointer ${
                          locked
                            ? 'bg-[#efe8d8] border-[#c8ba9f] text-[#6e604a]'
                            : 'bg-white border-[#3c3426] text-[#1f1a12] hover:bg-[#f2ebdc]'
                        }`}
                      >
                        +{uDef.namePt} ({formatCash(uDef.cost.gold)})
                      </button>
                    );
                  })}

                  {selectedExpansion.owner === 'player' && selectedRoadCheck && (!selectedRoad || selectedRoad.level < 5) && (
                    <button
                      type="button"
                      data-testid="build-road-selected"
                      title={selectedRoadCheck.reasonPt ?? roadButtonLabel}
                      onClick={onBuildRoadSelected}
                      className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-xl font-display text-xs font-bold border-2 whitespace-nowrap cursor-pointer ${
                        selectedRoadCheck.allowed
                          ? 'bg-[#2a2319] text-[#fcf9f2] border-[#1f1a12] hover:bg-[#1f1a12]'
                          : 'bg-[#efe8d8] text-[#5c5140] border-[#bcae96]'
                      }`}
                    >
                      <Route className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      {roadButtonLabel}
                    </button>
                  )}

                  {selectedExpansion.owner === 'player' && selectedHexHasConstruction && (
                    <button
                      type="button"
                      data-testid="desktop-demolish-selected"
                      onClick={onDemolishSelectedHex}
                      className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl font-display text-xs font-bold border-2 border-rose-950 bg-rose-700 text-white shadow-[0_2px_0_#4c0519] hover:bg-rose-800 whitespace-nowrap cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Demolir
                    </button>
                  )}

                  {selectedExpansion.owner === 'player' && !selectedHexHasConstruction && (
                    <button
                      type="button"
                      data-testid="desktop-build-here-button"
                      onClick={() => {
                        if (!dockOpen) onToggleDock();
                        onSetToolMode('build');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl font-display text-xs font-bold border-2 border-[#1e2d24] bg-emerald-700 text-white shadow-[0_2px_0_#1e2d24] hover:bg-emerald-800 whitespace-nowrap cursor-pointer"
                    >
                      <Hammer className="w-3.5 h-3.5" aria-hidden="true" />
                      Construir aqui
                    </button>
                  )}

                  {selectedExpansion.owner !== 'player' &&
                    selectedExpansion.owner !== 'neutral' && (
                      <button
                        type="button"
                        onClick={() => onOpenKingdomModal('diplomacy')}
                        className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl font-display text-xs font-bold border-2 border-[#3c3426] bg-[#efe8d8] text-[#1f1a12] hover:bg-[#e5dcc7] whitespace-nowrap cursor-pointer"
                      >
                        <Swords className="w-3.5 h-3.5" aria-hidden="true" />
                        Diplomacia / Guerra
                      </button>
                    )}

                  {selectedExpansion.owner === 'neutral' && selectedHexActiveExpansion && (
                    <span
                      data-testid="desktop-expanding-status"
                      className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl font-display text-xs font-bold border-2 border-sky-400 bg-sky-100 text-sky-900 whitespace-nowrap"
                    >
                      <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                      Incorporando ({selectedHexActiveExpansion.turnsRemaining}/
                      {selectedHexActiveExpansion.totalTurns}t)
                    </span>
                  )}

                  {selectedExpansion.owner === 'neutral' &&
                    !selectedHexActiveExpansion &&
                    selectedExpansion.isAdjacent && (
                      <button
                        type="button"
                        data-testid="desktop-conquer-button"
                        onClick={onConfirmSelectedHex}
                        className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-xl font-display text-xs font-bold border-2 whitespace-nowrap cursor-pointer ${
                          selectedExpansion.canExpand
                            ? 'bg-amber-500 text-[#1f1a12] border-[#3c3426] shadow-[0_2px_0_#3c3426] hover:bg-amber-400'
                            : 'bg-[#efe8d8] text-[#6e604a] border-[#bcae96]'
                        }`}
                      >
                        <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                        {getExpansionButtonLabel(selectedExpansion)}
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={onCancelAction}
                    aria-label="Fechar seleção"
                    className="ml-auto w-8 h-8 rounded-lg bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] hover:bg-[#e5dcc7] flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {/* Collapse / Expand Toggle Handle */}
            <button
              type="button"
              tabIndex={-1}
              title="Alternar painel de construção (H)"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleDock();
              }}
              className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-t-lg bg-[#fcf9f2]/96 border-2 border-b-0 border-[#3c3426] text-[11px] font-semibold text-[#3c3426] hover:bg-white cursor-pointer"
            >
              {dockOpen ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  Ocultar Peças
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  Mostrar Peças
                </>
              )}
            </button>

            <div className="pointer-events-auto w-full bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-2xl shadow-[0_4px_0_#3c3426] p-2.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onCyclePiece(-1);
                    }}
                    aria-label="Peça anterior (Q)"
                    title="Peça anterior (Q)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <div className="px-2.5 py-1 rounded-lg bg-white border border-[#d9ceb8] min-w-[175px] max-w-[260px]">
                    <p
                      data-testid="hud-active-piece"
                      className="text-xs font-bold text-[#1f1a12] truncate"
                    >
                      {activePieceLabel}
                    </p>
                    <p
                      data-testid="hud-orientation"
                      className="text-[10px] font-medium text-[#6e604a] tabular-nums truncate"
                    >
                      {activeTechLocked && activePieceDef.requiredTech
                        ? `Requer ${TECH_BY_ID[activePieceDef.requiredTech].namePt}`
                        : `${formatCompactCost(activeBuildEffectiveCost, activeAsset.price)} · ${activePieceDef.buildTimeTurns}t`}
                      {activePieceInfo.requiredTerrain
                        ? ` · Só ${TERRAIN_METADATA[activePieceInfo.requiredTerrain].labelPt}`
                        : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onCyclePiece(1);
                    }}
                    aria-label="Próxima peça (E)"
                    title="Próxima peça (E)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Tool & Camera Quick Controls */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSetToolMode('expand');
                    }}
                    aria-pressed={toolMode === 'expand'}
                    title="Modo Expandir: clique em hexágonos para selecionar ou incorporar"
                    className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-xs font-bold whitespace-nowrap cursor-pointer ${
                      toolMode === 'expand'
                        ? 'bg-amber-500 border-[#3c3426] text-[#1f1a12]'
                        : 'bg-white border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc]'
                    }`}
                  >
                    <Flag className="w-3.5 h-3.5" aria-hidden="true" />
                    Expandir
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSetToolMode('build');
                    }}
                    aria-pressed={toolMode === 'build'}
                    title="Modo Construir"
                    className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      toolMode === 'build'
                        ? 'bg-emerald-700 border-emerald-900 text-white'
                        : 'bg-white border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc]'
                    }`}
                  >
                    <Hammer className="w-3.5 h-3.5" aria-hidden="true" />
                    Construir
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    data-testid="desktop-road-button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSetToolMode(toolMode === 'road' ? 'expand' : 'road');
                    }}
                    aria-pressed={toolMode === 'road'}
                    title="Modo Estrada: clique em hexágonos seus para construir ou melhorar estradas"
                    className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      toolMode === 'road'
                        ? 'bg-[#2a2319] border-[#1f1a12] text-[#fcf9f2]'
                        : 'bg-white border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc]'
                    }`}
                  >
                    <Route className="w-3.5 h-3.5" aria-hidden="true" />
                    Estrada
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSetToolMode('demolish');
                    }}
                    aria-pressed={toolMode === 'demolish'}
                    title="Modo Demolir (ou tecla DEL)"
                    className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      toolMode === 'demolish'
                        ? 'bg-rose-700 border-rose-900 text-white'
                        : 'bg-white border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc]'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Demolir
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onRotatePiece();
                    }}
                    title="Girar peça em 60° (Botão direito ou R)"
                    className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-white border border-[#bcae96] text-xs font-semibold text-[#2a2319] hover:bg-[#f2ebdc] whitespace-nowrap cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Girar
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onRotateCamera(-Math.PI / 4);
                    }}
                    aria-label="Girar câmera esquerda"
                    title="Girar câmera -45°"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onRotateCamera(Math.PI / 4);
                    }}
                    aria-label="Girar câmera direita"
                    title="Girar câmera +45°"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onCenterCamera();
                    }}
                    aria-label="Centralizar câmera (F)"
                    title="Centralizar câmera (F)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onZoom(-1.6);
                    }}
                    aria-label="Aproximar câmera (+)"
                    title="Aproximar (+)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onZoom(1.6);
                    }}
                    aria-label="Afastar câmera (-)"
                    title="Afastar (-)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {dockOpen && (
                <div
                  data-testid="desktop-contextual-build"
                  className="pt-2 border-t border-[#e0d6c3] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-[#1f1a12]">
                      {selectedHex && contextualBuild
                        ? `O que posso construir neste hex? · ${contextualBuild.terrain.labelPt} (${contextualBuild.terrain.resourceLabelPt})`
                        : 'O que posso construir neste hex?'}
                    </p>
                    {contextualBuild?.hintPt && (
                      <p className="text-[11px] font-medium text-[#6e604a] truncate">
                        {contextualBuild.hintPt}
                      </p>
                    )}
                  </div>

                  {!selectedHex || !contextualBuild ? (
                    <p className="text-xs font-medium text-[#5c5140] py-1">
                      Selecione um hexágono livre do seu território no mapa para ver exatamente quais construções são compatíveis com aquele terreno.
                    </p>
                  ) : contextualBuild.options.length === 0 ? (
                    <p
                      data-testid="desktop-build-empty"
                      className="text-xs font-semibold text-[#5c5140] py-1"
                    >
                      {contextualBuild.blockedReasonPt ??
                        contextualBuild.hintPt ??
                        'Nenhuma construção compatível disponível neste hexágono.'}
                    </p>
                  ) : (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      {contextualBuild.options.map((opt) => {
                        const isSelected = opt.assetIndex === selectedIndex;
                        const asset = assets[opt.assetIndex];
                        return (
                          <button
                            key={opt.assetName}
                            type="button"
                            tabIndex={-1}
                            data-testid={`desktop-piece-${opt.assetName}`}
                            title={opt.definition.summaryPt}
                            onClick={(e) => {
                              e.currentTarget.blur();
                              onBuildOptionOnSelected(opt.assetIndex);
                            }}
                            className={`px-3 py-1.5 rounded-lg border-2 text-left transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              !opt.affordable
                                ? 'bg-[#f4efe4] border-[#d9ceb8] text-[#5c5140]'
                                : isSelected
                                  ? 'bg-emerald-700 border-emerald-950 text-white'
                                  : 'bg-white border-[#3c3426] text-[#1f1a12] hover:bg-[#f5efe1]'
                            }`}
                          >
                            <span className="block text-[11px] font-bold leading-tight">
                              {opt.definition.labelPt}
                            </span>
                            <span
                              className={`block text-[10px] font-medium tabular-nums ${
                                !opt.affordable
                                  ? 'text-rose-700'
                                  : isSelected
                                    ? 'text-emerald-100'
                                    : 'text-[#5c5140]'
                              }`}
                            >
                              {`${formatCompactCost(opt.effectiveCost, asset?.price ?? 0)} · ${opt.definition.buildTimeTurns}t`}
                            </span>
                            {opt.workerWarningPt && (
                              <span className="block text-[9px] font-bold text-amber-700">
                                {opt.workerWarningPt}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* PAUSE / SECONDARY MENU SHEET */}
      {gameState === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-title"
          className="fixed inset-0 z-40 bg-[#1a221d]/55 flex items-end sm:items-center justify-center sm:p-4 pointer-events-auto"
        >
          <div
            className="w-full max-w-md max-h-[88dvh] overflow-y-auto hex-touch-scroll bg-[#fcf9f2] border-t-2 sm:border-2 border-[#3c3426] rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-[0_8px_0_#3c3426] space-y-4"
            style={{
              paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="pause-title" className="font-display text-2xl font-bold text-[#1f1a12]">
                  Menu &amp; Pausa
                </h2>
                <p className="mt-1 text-xs text-[#5c5140]">
                  Turno {turn} · {stage.labelPt}
                  {worldSeed !== undefined ? ` · Mundo #${worldSeed}` : ''}
                </p>
              </div>

              <button
                type="button"
                onClick={onResume}
                aria-label="Fechar menu"
                className="w-11 h-11 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Saldo</p>
                <p className="mt-0.5 font-display text-sm font-bold text-[#1f1a12] tabular-nums truncate">
                  {formatCash(cash)}
                </p>
              </div>
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">População</p>
                <p className="mt-0.5 font-display text-sm font-bold text-[#1f1a12] tabular-nums">
                  {economy.population.current}/{economy.population.capacity}
                </p>
              </div>
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Território</p>
                <p className="mt-0.5 font-display text-sm font-bold text-[#9a6308] tabular-nums">
                  {territoryCount}/{territorySummary.capacity}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onResume();
                }}
                className="w-full min-h-[48px] py-2.5 px-4 rounded-xl bg-emerald-700 text-white font-display text-sm font-bold border-2 border-[#1e2d24] shadow-[0_3px_0_#1e2d24] hover:bg-emerald-800 cursor-pointer"
              >
                Continuar Jogando
              </button>

              <button
                type="button"
                onClick={() => {
                  onResume();
                  onOpenKingdomModal('economy');
                }}
                className="w-full min-h-[46px] py-2 px-3 rounded-xl bg-amber-500 text-[#1f1a12] border-2 border-[#3c3426] font-display text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Crown className="w-4 h-4" aria-hidden="true" />
                Abrir Painel do Reino
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSaveMap();
                    onResume();
                  }}
                  className="min-h-[46px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-bold text-[#2a2319] hover:bg-[#f5efe1] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  Salvar Reino
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onLoadMap();
                    onResume();
                  }}
                  className="min-h-[46px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-bold text-[#2a2319] hover:bg-[#f5efe1] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-amber-700" aria-hidden="true" />
                  Carregar Reino
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onToggleMute}
                  className="min-h-[46px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-bold text-[#2a2319] hover:bg-[#f5efe1] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {muted ? (
                    <>
                      <VolumeX className="w-4 h-4 text-rose-700" aria-hidden="true" />
                      Som: Off
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                      Som: On
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onToggleAutoTurn}
                  className="min-h-[46px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-bold text-[#2a2319] hover:bg-[#f5efe1] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FastForward
                    className={`w-4 h-4 ${autoTurnEnabled ? 'text-emerald-700' : 'text-[#6e604a]'}`}
                    aria-hidden="true"
                  />
                  Auto-turno: {autoTurnEnabled ? 'On' : 'Off'}
                </button>
              </div>

              <button
                type="button"
                data-testid="new-world-button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onNewProceduralWorld();
                }}
                className="w-full min-h-[46px] py-2 px-3 rounded-xl bg-[#efe8d8] border-2 border-[#3c3426] text-xs font-bold text-[#1f1a12] hover:bg-[#e5dcc7] inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                Gerar Novo Mapa Procedural
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onResetStarter();
                  }}
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-semibold text-[#2a2319] hover:bg-[#f5efe1] cursor-pointer"
                >
                  Reiniciar Reino
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onClearMap();
                  }}
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-semibold text-[#2a2319] hover:bg-[#f5efe1] cursor-pointer"
                >
                  Mapa Limpo
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onCenterCamera();
                    onResume();
                  }}
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-xs font-semibold text-[#2a2319] hover:bg-[#e5dcc7] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Crosshair className="w-4 h-4" aria-hidden="true" />
                  Centralizar Câmera
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onBackToTitle();
                  }}
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-xs font-semibold text-[#2a2319] hover:bg-[#e5dcc7] cursor-pointer"
                >
                  Tela Inicial
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default GameHud;
