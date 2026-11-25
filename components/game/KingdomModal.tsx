'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CloudRain,
  Coins,
  Flag,
  FlaskConical,
  Hammer,
  Handshake,
  Lock,
  Moon,
  Route,
  Scale,
  Shield,
  Snowflake,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Swords,
  Thermometer,
  Users,
  Wind,
  X,
} from 'lucide-react';
import { getBuildingDefinition } from '@/lib/buildings-catalog';
import type { TurnProductionBreakdown, KingdomStageInfo } from '@/lib/economy-engine';
import { countFactionTerritory } from '@/lib/faction-engine';
import type { KingdomState } from '@/lib/kingdom-engine';
import { UNIT_CATALOG, type UnitEntity } from '@/lib/military-engine';
import { TECH_BY_ID, TECH_TREE, canStartResearch, type TechId } from '@/lib/tech-engine';
import { TERRAIN_METADATA, getHexTerrainAndResource } from '@/lib/terrain-engine';
import type { TerritorialCapacitySummary } from '@/lib/territory-engine';
import type { MarketSummary, TradableResource } from '@/lib/trade-engine';
import { computeCalendarSnapshot } from '@/lib/calendar-engine';
import { DAY_PHASE_META, getDayPhaseForTurn } from '@/lib/day-night-engine';
import { SEASON_PROFILES, createInitialClimateWeather } from '@/lib/season-engine';
import { toRomanLevel } from '@/lib/building-upgrade-engine';
import { BUILDING_MODULES } from '@/lib/building-modules-engine';

export type KingdomModalTab = 'economy' | 'trade' | 'research' | 'military' | 'diplomacy';

export interface KingdomModalProps {
  open: boolean;
  initialTab?: KingdomModalTab;
  kingdomState: KingdomState;
  economy: TurnProductionBreakdown;
  territorySummary: TerritorialCapacitySummary;
  market: MarketSummary;
  stage: KingdomStageInfo;
  militaryPower: {
    attackPower: number;
    defensePower: number;
    unitCount: number;
    unitMaintenanceGold: number;
  };
  onClose: () => void;
  onSelectTech: (techId: TechId) => void;
  onResolveEvent: (choiceId: string) => void;
  onDiplomacy: (factionId: string, action: 'truce' | 'trade_pact' | 'war') => void;
  onTrade: (resource: TradableResource, action: 'buy' | 'sell', quantity: number) => void;
  onFocusUnit: (unit: UnitEntity) => void;
}

function formatCash(value: number): string {
  return `$${Math.round(value).toLocaleString('pt-BR')}`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

export default function KingdomModal({
  open,
  initialTab = 'economy',
  kingdomState,
  economy,
  territorySummary,
  market,
  stage,
  militaryPower,
  onClose,
  onSelectTech,
  onResolveEvent,
  onDiplomacy,
  onTrade,
  onFocusUnit,
}: KingdomModalProps) {
  const [activeTab, setActiveTab] = useState<KingdomModalTab>(initialTab);
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab);

  if (open !== prevOpen || initialTab !== prevInitialTab) {
    setPrevOpen(open);
    setPrevInitialTab(initialTab);
    if (open) {
      setActiveTab(initialTab);
    }
  }

  if (!open) return null;

  const playerUnits = kingdomState.units.filter(
    (u) => u.owner === 'player' && u.hp > 0
  );
  const activeTech = kingdomState.research.activeTechId
    ? TECH_BY_ID[kingdomState.research.activeTechId]
    : null;
  const calendar =
    kingdomState.calendar ?? computeCalendarSnapshot(kingdomState.turn);
  const dayPhase =
    kingdomState.dayPhase ?? getDayPhaseForTurn(kingdomState.turn);
  const climateWeather =
    kingdomState.climateWeather ?? createInitialClimateWeather();
  const seasonProfile = SEASON_PROFILES[calendar.season];

  const renderPhaseIcon = () => {
    if (dayPhase === 'dawn') {
      return <Sunrise className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />;
    }
    if (dayPhase === 'dusk') {
      return <Sunset className="w-4 h-4 text-orange-600 shrink-0" aria-hidden="true" />;
    }
    if (dayPhase === 'night') {
      return <Moon className="w-4 h-4 text-indigo-700 shrink-0" aria-hidden="true" />;
    }
    return <Sun className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />;
  };

  const renderWeatherIcon = () => {
    if (climateWeather.id === 'rain') {
      return <CloudRain className="w-4 h-4 text-sky-700 shrink-0" aria-hidden="true" />;
    }
    if (climateWeather.id === 'frost') {
      return <Snowflake className="w-4 h-4 text-sky-600 shrink-0" aria-hidden="true" />;
    }
    if (climateWeather.id === 'storm') {
      return <Wind className="w-4 h-4 text-slate-700 shrink-0" aria-hidden="true" />;
    }
    if (climateWeather.id === 'drought_weather') {
      return <Thermometer className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />;
    }
    return <Sun className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />;
  };

  const tabs: Array<{ id: KingdomModalTab; label: string; alert?: boolean }> = [
    { id: 'economy', label: 'Economia' },
    { id: 'trade', label: 'Comércio' },
    { id: 'research', label: 'Pesquisa' },
    { id: 'military', label: 'Exército' },
    {
      id: 'diplomacy',
      label: 'Facções',
      alert: Boolean(kingdomState.activeEvent),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kingdom-modal-title"
      data-testid="kingdom-modal"
      className="fixed inset-0 z-40 bg-[#1a221d]/55 flex items-end sm:items-center justify-center sm:p-4 pointer-events-auto"
    >
      <button
        type="button"
        aria-label="Fechar painel do reino"
        onClick={onClose}
        className="fixed inset-0 cursor-default"
      />

      <div
        className="relative z-10 w-full max-w-2xl max-h-[86dvh] flex flex-col bg-[#fcf9f2] border-t-2 sm:border-2 border-[#3c3426] rounded-t-3xl sm:rounded-2xl shadow-[0_8px_0_#3c3426] overflow-hidden"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[#e0d6c3] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
              Turno {kingdomState.turn} · Estágio {stage.stageIndex}/5
            </p>
            <h2
              id="kingdom-modal-title"
              className="font-display text-xl sm:text-2xl font-bold text-[#1f1a12] truncate"
            >
              {stage.labelPt}
            </h2>
            <p className="text-xs text-[#5c5140] mt-0.5 truncate">
              Meta: {stage.nextMilestonePt}
            </p>
          </div>

          <button
            type="button"
            data-testid="kingdom-modal-close"
            onClick={onClose}
            aria-label="Fechar painel do reino"
            className="w-11 h-11 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] hover:bg-[#e5dcc7] flex items-center justify-center shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-4 py-2.5 border-b border-[#e0d6c3] flex items-center gap-1.5 overflow-x-auto hex-touch-scroll-x shrink-0 bg-[#f6f0e3]">
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`kingdom-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[42px] px-3.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer ${
                  selected
                    ? 'bg-[#2a2319] text-[#fcf9f2]'
                    : 'bg-white border border-[#d9ceb8] text-[#3c3426] hover:bg-[#efe8d8]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.alert && (
                  <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500 text-[#1f1a12] text-[10px] leading-none font-bold">
                    1
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto hex-touch-scroll p-4 sm:p-5 space-y-4">
          {activeTab === 'economy' && (
            <div className="space-y-4">
              {/* Calendar, Season & Climate */}
              <section
                data-testid="season-climate-card"
                className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    Calendário, Estação e Clima
                  </h3>
                  <span className="text-xs font-bold text-[#3c3426] tabular-nums">
                    {calendar.formattedDatePt}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs tabular-nums">
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Estação</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {calendar.seasonLabelPt}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Ciclo Visual</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12] flex items-center gap-1.5">
                      {renderPhaseIcon()}
                      <span>{DAY_PHASE_META[dayPhase].labelPt}</span>
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Tempo</p>
                    <p className="mt-0.5 font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                      {renderWeatherIcon()}
                      <span className="truncate">{climateWeather.labelPt}</span>
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Inverno</p>
                    <p
                      className={`mt-0.5 font-display text-base font-bold ${
                        calendar.season === 'winter' || calendar.isWinterWarning
                          ? 'text-sky-800'
                          : 'text-[#1f1a12]'
                      }`}
                    >
                      {calendar.season === 'winter'
                        ? `Ativo (${calendar.turnsUntilNextSeason}t)`
                        : `Em ${calendar.turnsUntilWinter}t`}
                    </p>
                  </div>
                </div>

                <p className="text-xs font-medium text-[#3c3426]">
                  {seasonProfile.descriptionPt}
                  {climateWeather.id !== 'clear'
                    ? ` Clima (${climateWeather.turnsRemaining}t): ${climateWeather.descriptionPt}`
                    : ''}
                </p>

                <p className="text-[11px] font-semibold text-[#5c5140] tabular-nums">
                  Reserva de alimento: {kingdomState.resources.food} ({formatSigned(economy.foodNet)}/turno)
                  {economy.seasonalSummaryPt ? ` · ${economy.seasonalSummaryPt}` : ''}
                </p>
              </section>

              {/* Population & Workers */}
              <section className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    População e Mão de Obra
                  </h3>
                  <span className="text-xs font-bold text-[#3c3426] tabular-nums">
                    Eficiência {Math.round(economy.population.efficiency * 100)}%
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs tabular-nums">
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Moradores</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {economy.population.current} / {economy.population.capacity}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Livres</p>
                    <p className="mt-0.5 font-display text-base font-bold text-emerald-800">
                      {economy.population.availableWorkers}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Obras / Tropas</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {economy.population.buildingWorkersAssigned}/{economy.population.buildingWorkersRequired}
                      {economy.population.unitWorkersUsed > 0
                        ? ` + ${economy.population.unitWorkersUsed}t`
                        : ''}
                      {economy.population.expansionWorkersUsed > 0
                        ? ` + ${economy.population.expansionWorkersUsed}exp`
                        : ''}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Crescimento</p>
                    <p
                      className={`mt-0.5 font-display text-base font-bold ${
                        economy.population.projectedGrowth < 0
                          ? 'text-rose-700'
                          : 'text-[#1f1a12]'
                      }`}
                    >
                      {formatSigned(economy.population.projectedGrowth)} / turno
                    </p>
                  </div>
                </div>

                {economy.population.efficiencyReasonPt && (
                  <p
                    className={`text-xs font-semibold ${
                      economy.population.hasFoodDeficit || economy.population.efficiency < 0.99
                        ? 'text-rose-700'
                        : 'text-[#5c5140]'
                    }`}
                  >
                    {economy.population.efficiencyReasonPt}
                  </p>
                )}

                <div className="pt-2 border-t border-[#ece4d3] flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900">
                    Operando: {economy.operationCounts.operating}
                  </span>
                  {economy.operationCounts.partial > 0 && (
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                      Parcial: {economy.operationCounts.partial}
                    </span>
                  )}
                  {economy.operationCounts.idle > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900">
                      Parado: {economy.operationCounts.idle}
                    </span>
                  )}
                  {economy.operationCounts.underConstruction > 0 && (
                    <span className="px-2 py-0.5 rounded bg-[#f7f2e6] text-[#5c5140]">
                      Em obra: {economy.operationCounts.underConstruction}
                    </span>
                  )}
                </div>

                {economy.attentionHexKeys.length > 0 && (
                  <div className="space-y-1 text-xs">
                    {economy.attentionHexKeys.slice(0, 4).map((bKey) => {
                      const rep = economy.buildingsByKey[bKey];
                      if (!rep) return null;
                      return (
                        <div
                          key={bKey}
                          className="flex items-center justify-between gap-2 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5"
                        >
                          <span className="font-bold text-[#1f1a12]">
                            {rep.labelPt} ({rep.statusLabelPt})
                          </span>
                          <span className="text-[11px] text-rose-800 truncate">
                            {rep.reasonPt}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Territorial Capacity & Organic Expansion */}
              <section
                data-testid="territory-capacity-card"
                className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <Flag className="w-4 h-4 text-amber-600" aria-hidden="true" />
                    Capacidade Territorial e Expansão
                  </h3>
                  <span className="text-xs font-bold text-[#3c3426] tabular-nums">
                    Restam {territorySummary.remaining} {territorySummary.remaining === 1 ? 'vaga' : 'vagas'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs tabular-nums">
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Controlados</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {territorySummary.controlled}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Em Curso</p>
                    <p className="mt-0.5 font-display text-base font-bold text-sky-700">
                      {territorySummary.inProgress}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Capacidade</p>
                    <p className="mt-0.5 font-display text-base font-bold text-emerald-800">
                      {territorySummary.used} / {territorySummary.capacity}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Alcance Adm.</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {territorySummary.maxAnchorReach} hexes
                    </p>
                  </div>
                </div>

                <p className="text-[11px] font-semibold text-[#5c5140] tabular-nums">
                  Base +{territorySummary.baseCapacity} · População +{territorySummary.populationBonus} · Infraestrutura +{territorySummary.infrastructureBonus}
                  {territorySummary.cityBonus > 0 ? ` · Cidades +${territorySummary.cityBonus}` : ''}
                  {territorySummary.roadBonus > 0 ? ` · Estradas +${territorySummary.roadBonus}` : ''}
                  {` · Tecnologia +${territorySummary.techBonus}`}
                </p>

                {(kingdomState.expansions ?? []).length > 0 && (
                  <div className="pt-2 border-t border-[#ece4d3] space-y-1.5 text-xs">
                    {(kingdomState.expansions ?? []).map((exp) => {
                      const tile = kingdomState.worldState.hexes[`${exp.q},${exp.r}`];
                      const info = getHexTerrainAndResource(exp.q, exp.r, tile);
                      return (
                        <div
                          key={`${exp.q},${exp.r}`}
                          className="flex items-center justify-between gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-1.5"
                        >
                          <span className="font-bold text-[#1f1a12]">
                            Incorporando {TERRAIN_METADATA[info.terrainType].labelPt}
                          </span>
                          <span className="text-[11px] font-bold text-sky-800 tabular-nums">
                            {exp.turnsRemaining}/{exp.totalTurns}t · {exp.workersCommitted} trab.
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Organic Cities, Regional Districts & Road Network */}
              <section
                data-testid="cities-network-card"
                className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    Cidades, Distritos e Rede Viária
                  </h3>
                  <span className="text-xs font-bold text-[#3c3426] tabular-nums">
                    {(kingdomState.cities ?? []).length}{' '}
                    {(kingdomState.cities ?? []).length === 1 ? 'cidade' : 'cidades'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs tabular-nums">
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Estradas</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {economy.roadConnectivity?.totalRoadTiles ?? 0}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Rede / Corredores</p>
                    <p className="mt-0.5 font-display text-base font-bold text-emerald-800">
                      +{formatCash(economy.networkTradeGold + economy.corridorTradeGold)}/t
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Manut. Viária</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      -{formatCash(economy.roadMaintenanceGold)}/t
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Distritos</p>
                    <p className="mt-0.5 font-display text-base font-bold text-sky-800">
                      {economy.regionalSummary?.allDistricts.length ?? 0}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {(kingdomState.cities ?? []).map((city) => (
                    <div
                      key={city.id}
                      className="bg-[#f7f2e6] border border-[#e0d6c3] rounded-lg p-2.5 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-display text-xs font-bold text-[#1f1a12]">
                          {city.name} · {city.stageLabelPt} (Estágio {city.level}/5)
                        </span>
                        <span className="text-[11px] font-semibold text-[#5c5140] tabular-nums">
                          População: {city.population} / {city.housingCapacity} · Cresc.{' '}
                          {city.growthPerTurn >= 0 ? '+' : ''}
                          {city.growthPerTurn}/turno · Trab. livres: {city.availableWorkers}
                          {(city.regionHexKeys?.length ?? 0) > 0
                            ? ` · ${city.regionHexKeys?.length} hexes na região`
                            : ''}{' '}
                          · {city.stabilityLabelPt}
                          {city.nextLevelScore !== null
                            ? ` · Evol. ${city.developmentScore}/${city.nextLevelScore}`
                            : ' · Máx.'}
                        </span>
                      </div>

                      {city.specializations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {city.specializations.map((spec, idx) => (
                            <span
                              key={spec.id}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                idx === 0
                                  ? 'bg-emerald-700 text-white'
                                  : 'bg-emerald-100 text-emerald-900'
                              }`}
                            >
                              {spec.labelPt} · {spec.stageLabelPt}
                            </span>
                          ))}
                          {city.connectedCityIds.length > 0 && (
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                              Conectada a {city.connectedCityIds.length}{' '}
                              {city.connectedCityIds.length === 1 ? 'cidade' : 'cidades'}
                            </span>
                          )}
                        </div>
                      )}

                      {city.primarySpecialization && (
                        <p className="text-[11px] font-semibold text-emerald-900">
                          Bônus Regional: {city.primarySpecialization.bonusSummaryPt}
                        </p>
                      )}

                      {city.districts.length > 0 && (
                        <p className="text-[11px] text-[#3c3426]">
                          Distritos:{' '}
                          {city.districts.map((d) => `${d.labelPt} (${d.summaryPt})`).join(' · ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Active Multi-Turn Effects */}
              {kingdomState.activeEffects.length > 0 && (
                <section
                  data-testid="active-effects-card"
                  className="bg-amber-50 border border-amber-400 rounded-xl p-3.5 space-y-2"
                >
                  <h3 className="font-display text-sm font-bold text-amber-950 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    Efeitos Mundiais Ativos
                  </h3>
                  <div className="space-y-1.5 text-xs">
                    {kingdomState.activeEffects.map((eff) => (
                      <div
                        key={eff.id}
                        className="flex items-center justify-between gap-2 bg-white/80 border border-amber-200 rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-[#1f1a12]">{eff.titlePt}</p>
                          <p className="text-[11px] text-[#5c5140]">{eff.descriptionPt}</p>
                        </div>
                        <span className="px-2 py-1 rounded-md bg-amber-200/80 text-amber-950 text-[11px] font-bold whitespace-nowrap tabular-nums">
                          {eff.turnsRemaining} {eff.turnsRemaining === 1 ? 'turno' : 'turnos'}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Active Multi-Turn Constructions Queue */}
              {kingdomState.constructions.length > 0 && (
                <section
                  data-testid="active-constructions-card"
                  className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2"
                >
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <Hammer className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    Obras em Andamento ({kingdomState.constructions.length})
                  </h3>
                  <div className="space-y-1.5 text-xs">
                    {kingdomState.constructions.map((c) => {
                      const def = getBuildingDefinition(c.assetName);
                      const modLabel =
                        c.kind === 'module' && c.moduleId && c.moduleId in BUILDING_MODULES
                          ? BUILDING_MODULES[c.moduleId].labelPt
                          : null;
                      const title =
                        c.kind === 'upgrade'
                          ? `${def.labelPt} → Nv. ${toRomanLevel(c.targetLevel ?? 2)}`
                          : modLabel
                            ? `${def.labelPt} · Módulo: ${modLabel}`
                            : def.labelPt;
                      return (
                        <div
                          key={`${c.q},${c.r}`}
                          className="flex items-center justify-between gap-2 bg-[#f7f2e6] rounded-lg px-3 py-2"
                        >
                          <span className="font-bold text-[#1f1a12]">{title}</span>
                          <span className="text-[11px] font-bold text-amber-800 tabular-nums">
                            Faltam {c.turnsRemaining}/{c.totalTurns} turnos
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Treasury & Resources Table */}
              <section className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2.5">
                <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  Balanço de Recursos por Turno
                </h3>

                <div className="divide-y divide-[#ece4d3] text-xs tabular-nums">
                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="font-bold text-[#1f1a12]">Ouro (Tesouro)</span>
                    <div className="text-right">
                      <span className="font-bold text-[#1f1a12] mr-3">
                        {formatCash(kingdomState.worldState.cash)}
                      </span>
                      <span
                        className={`font-bold ${
                          economy.goldNet >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {economy.goldNet >= 0 ? '+' : ''}
                        {formatCash(economy.goldNet)}/turno
                      </span>
                      <p className="text-[11px] text-[#6e604a]">
                        Bruto {formatCash(economy.goldGross)} · Manutenção -{formatCash(economy.goldMaintenance)}
                        {economy.goldTradePactBonus > 0
                          ? ` · Acordos +${formatCash(economy.goldTradePactBonus)}`
                          : ''}
                        {economy.networkTradeGold + economy.corridorTradeGold > 0
                          ? ` · Rede Viária +${formatCash(economy.networkTradeGold + economy.corridorTradeGold)}`
                          : ''}
                        {economy.regionalBonusGold > 0
                          ? ` · Regiões +${formatCash(economy.regionalBonusGold)}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#2a2319]">Madeira</span>
                    <div>
                      <span className="font-bold text-[#1f1a12] mr-3">
                        {kingdomState.resources.wood} / {economy.storageCaps.wood}
                      </span>
                      <span className="font-bold text-emerald-700">
                        {formatSigned(economy.woodNet)}/turno
                      </span>
                    </div>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#2a2319]">Pedra</span>
                    <div>
                      <span className="font-bold text-[#1f1a12] mr-3">
                        {kingdomState.resources.stone} / {economy.storageCaps.stone}
                      </span>
                      <span className="font-bold text-emerald-700">
                        {formatSigned(economy.stoneNet)}/turno
                      </span>
                    </div>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-[#2a2319]">Alimento</span>
                      <span className="ml-2 text-[11px] text-[#6e604a]">
                        (Consumo -{economy.foodConsumed}/turno)
                      </span>
                    </div>
                    <div>
                      <span className="font-bold text-[#1f1a12] mr-3">
                        {kingdomState.resources.food} / {economy.storageCaps.food}
                      </span>
                      <span
                        className={`font-bold ${
                          economy.foodNet >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {formatSigned(economy.foodNet)}/turno
                      </span>
                    </div>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-[#2a2319]">Minério</span>
                      {economy.oreConsumed > 0 && (
                        <span className="ml-2 text-[11px] text-[#6e604a]">
                          (Fundição -{economy.oreConsumed}/turno)
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="font-bold text-[#1f1a12] mr-3">
                        {kingdomState.resources.ore} / {economy.storageCaps.ore}
                      </span>
                      <span
                        className={`font-bold ${
                          economy.oreNet >= 0 ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {formatSigned(economy.oreNet)}/turno
                      </span>
                    </div>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#2a2319]">Metal</span>
                    <div>
                      <span className="font-bold text-[#1f1a12] mr-3">
                        {kingdomState.resources.metal} / {economy.storageCaps.metal}
                      </span>
                      <span className="font-bold text-emerald-700">
                        {formatSigned(economy.metalNet)}/turno
                      </span>
                    </div>
                  </div>

                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#2a2319]">Ciência</span>
                    <span className="font-bold text-sky-700">
                      {formatSigned(economy.scienceNet)}/turno
                    </span>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'trade' && (
            <div className="space-y-4">
              <section className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <Scale className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    Mercado Real de Recursos
                  </h3>
                  <p className="text-xs text-[#5c5140] mt-0.5">
                    Preços variam conforme excedente, escassez, mercados, portos e acordos.
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <p className="text-[11px] font-bold text-emerald-800">
                    Bônus Comercial: +{market.tradeBonusPercent}%
                  </p>
                  <p className="text-[11px] text-[#5c5140]">
                    Mercados/Portos: {market.marketCount} · Cidades na rede: {market.connectedCitiesCount}
                  </p>
                </div>
              </section>

              <section
                data-testid="trade-corridors-card"
                className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <Route className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    Corredores Comerciais entre Cidades
                  </h3>
                  <span className="text-xs font-bold text-emerald-800 tabular-nums">
                    {market.corridorCount} {market.corridorCount === 1 ? 'corredor' : 'corredores'}
                  </span>
                </div>
                {(economy.regionalSummary?.tradeCorridors ?? []).length > 0 ? (
                  <div className="space-y-1.5 text-xs">
                    {(economy.regionalSummary?.tradeCorridors ?? []).map((corr) => (
                      <div
                        key={corr.id}
                        className="flex items-center justify-between gap-2 bg-[#f7f2e6] rounded-lg px-3 py-1.5"
                      >
                        <span className="font-semibold text-[#1f1a12]">
                          {corr.cityAName} ↔ {corr.cityBName} ({corr.labelPt})
                        </span>
                        <span className="font-bold text-emerald-800 tabular-nums">
                          +{formatCash(corr.goldBonus)}/t
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#5c5140]">
                    Funde uma segunda cidade (Vila, Mansão ou Castelo) e ligue as cidades por estradas para abrir corredores comerciais de alto valor.
                  </p>
                )}
              </section>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {market.quotes.map((quote) => {
                  const statusClass =
                    quote.condition === 'excedente'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : quote.condition === 'escassez'
                        ? 'bg-rose-100 text-rose-900 border-rose-300'
                        : 'bg-[#f4efe4] text-[#3c3426] border-[#d9ceb8]';
                  const buyLot = Math.max(1, Math.min(10, quote.cap - quote.stock));
                  const sellLot = Math.max(1, Math.min(10, quote.stock));
                  const canBuy =
                    quote.stock < quote.cap &&
                    kingdomState.worldState.cash >= buyLot * quote.buyPricePerUnit;
                  const canSell = quote.stock > 0;

                  return (
                    <div
                      key={quote.resource}
                      data-testid={`trade-card-${quote.resource}`}
                      className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2.5 tabular-nums"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-display text-sm font-bold text-[#1f1a12]">
                            {quote.labelPt}
                          </p>
                          <p className="text-[11px] text-[#5c5140]">
                            Estoque: {quote.stock}/{quote.cap} ({formatSigned(quote.netPerTurn)}/t)
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${statusClass}`}
                        >
                          {quote.conditionLabelPt}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs bg-[#f7f2e6] rounded-lg px-2.5 py-1.5">
                        <span className="text-[#5c5140]">
                          Compra: <strong className="text-[#1f1a12]">${quote.buyPricePerUnit}/un</strong>
                        </span>
                        <span className="text-[#5c5140]">
                          Venda: <strong className="text-emerald-800">${quote.sellPricePerUnit}/un</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          data-testid={`trade-buy-${quote.resource}`}
                          onClick={() => onTrade(quote.resource, 'buy', 10)}
                          className={`min-h-[42px] px-2.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                            canBuy
                              ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                              : 'bg-[#efe8d8] text-[#6e604a] border border-[#c8ba9f]'
                          }`}
                        >
                          +{buyLot} (${buyLot * quote.buyPricePerUnit})
                        </button>
                        <button
                          type="button"
                          data-testid={`trade-sell-${quote.resource}`}
                          onClick={() => onTrade(quote.resource, 'sell', 10)}
                          className={`min-h-[42px] px-2.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                            canSell
                              ? 'bg-[#2a2319] text-[#fcf9f2] hover:bg-[#1f1a12]'
                              : 'bg-[#efe8d8] text-[#6e604a] border border-[#c8ba9f]'
                          }`}
                        >
                          -{sellLot} (+${sellLot * quote.sellPricePerUnit})
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'research' && (
            <div className="space-y-4">
              {/* Active Research Banner */}
              <section className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                    <FlaskConical className="w-4 h-4 text-sky-700" aria-hidden="true" />
                    Pesquisa Ativa
                  </h3>
                  <span className="text-xs font-bold text-sky-700 tabular-nums">
                    +{economy.scienceNet} Ciência / turno
                  </span>
                </div>

                {activeTech ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-[#1f1a12] tabular-nums">
                      <span>{activeTech.namePt}</span>
                      <span>
                        {kingdomState.research.progressScience} / {activeTech.costScience}
                      </span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-[#e8dfd0] overflow-hidden">
                      <div
                        className="h-full bg-sky-600 transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (kingdomState.research.progressScience / activeTech.costScience) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-[#5c5140]">{activeTech.effectsSummaryPt}</p>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 font-semibold">
                    Todas as tecnologias disponíveis foram pesquisadas!
                  </p>
                )}
              </section>

              {/* Full 7-Tech Tree */}
              <div className="space-y-2">
                {TECH_TREE.map((tech) => {
                  const unlocked = kingdomState.research.unlocked.includes(tech.id);
                  const isActive = kingdomState.research.activeTechId === tech.id;
                  const available = canStartResearch(kingdomState.research, tech.id);
                  const missingPrereqs = tech.prerequisites
                    .filter((p) => !kingdomState.research.unlocked.includes(p))
                    .map((p) => TECH_BY_ID[p]?.namePt ?? p);

                  return (
                    <div
                      key={tech.id}
                      data-testid={`tech-card-${tech.id}`}
                      className={`rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                        unlocked
                          ? 'bg-emerald-50/80 border-emerald-300'
                          : isActive
                            ? 'bg-sky-50/90 border-sky-400'
                            : 'bg-white border-[#d9ceb8]'
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase text-[#6e604a]">
                            Nível {tech.tier}
                          </span>
                          <span className="font-display text-sm font-bold text-[#1f1a12]">
                            {tech.namePt}
                          </span>
                          <span className="text-[11px] font-bold text-[#5c5140] tabular-nums">
                            {tech.costScience} Ciência
                          </span>
                        </div>
                        <p className="text-xs text-[#3c3426] font-medium">
                          {tech.effectsSummaryPt}
                        </p>
                        {!unlocked && missingPrereqs.length > 0 && (
                          <p className="text-[11px] text-rose-700 font-medium">
                            Requer: {missingPrereqs.join(', ')}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0">
                        {unlocked ? (
                          <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold whitespace-nowrap">
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            Concluída
                          </span>
                        ) : isActive ? (
                          <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-sky-700 text-white text-xs font-bold whitespace-nowrap">
                            Em Pesquisa
                          </span>
                        ) : available ? (
                          <button
                            type="button"
                            data-testid={`tech-select-${tech.id}`}
                            onClick={() => onSelectTech(tech.id)}
                            className="min-h-[42px] px-3.5 rounded-xl bg-[#2a2319] text-white text-xs font-bold hover:bg-[#1f1a12] whitespace-nowrap cursor-pointer"
                          >
                            Pesquisar
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-[#efe8d8] text-[#6e604a] text-xs font-semibold whitespace-nowrap">
                            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                            Bloqueada
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'military' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
                <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                  <p className="text-[10px] font-bold uppercase text-[#6e604a]">Ataque</p>
                  <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                    {militaryPower.attackPower}
                  </p>
                </div>
                <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                  <p className="text-[10px] font-bold uppercase text-[#6e604a]">Defesa Total</p>
                  <p className="mt-0.5 font-display text-base font-bold text-emerald-800">
                    {militaryPower.defensePower}
                  </p>
                </div>
                <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                  <p className="text-[10px] font-bold uppercase text-[#6e604a]">Tropas</p>
                  <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                    {militaryPower.unitCount}
                  </p>
                </div>
                <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                  <p className="text-[10px] font-bold uppercase text-[#6e604a]">Manutenção</p>
                  <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                    {formatCash(militaryPower.unitMaintenanceGold)}/t
                  </p>
                </div>
              </div>

              {/* Active Player Units */}
              <section className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2.5">
                <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                  <Swords className="w-4 h-4 text-rose-700" aria-hidden="true" />
                  Suas Unidades ({playerUnits.length})
                </h3>

                {playerUnits.length === 0 ? (
                  <p className="text-xs text-[#5c5140]">
                    Nenhuma tropa ativa. Pesquise Militar e construa um Quartel ou selecione o Castelo Real no mapa para recrutar tropas.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {playerUnits.map((unit) => {
                      const def = UNIT_CATALOG[unit.type];
                      return (
                        <div
                          key={unit.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#f7f2e6] border border-[#e0d6c3]"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#1f1a12]">
                              {def.namePt} · HP {unit.hp}/{unit.maxHp}
                            </p>
                            <p className="text-[11px] text-[#5c5140]">
                              ATQ {def.attack} · DEF {def.defense} ·{' '}
                              {unit.movedThisTurn ? 'Agiu neste turno' : 'Pronta para mover'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onFocusUnit(unit)}
                            className="min-h-[40px] px-3 rounded-lg bg-emerald-700 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
                          >
                            Selecionar
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Unit Roster Reference */}
              <section className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2">
                <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-[#3c3426]" aria-hidden="true" />
                  Recrutamento (Toque no Castelo, Quartel ou Porto)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {Object.values(UNIT_CATALOG).map((u) => {
                    const locked =
                      u.requiredTech !== null &&
                      !kingdomState.research.unlocked.includes(u.requiredTech);
                    return (
                      <div
                        key={u.type}
                        className="p-2.5 rounded-lg bg-[#f7f2e6] border border-[#e0d6c3] space-y-0.5 tabular-nums"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[#1f1a12]">{u.namePt}</span>
                          <span className="text-[11px] font-bold text-[#5c5140]">
                            ATQ {u.attack} · DEF {u.defense}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#5c5140]">
                          {formatCash(u.cost.gold)} · {u.cost.wood} Mad · {u.cost.food} Alim · {u.cost.ore} Min
                          {u.cost.metal > 0 ? ` · ${u.cost.metal} Met` : ''}
                        </p>
                        {locked && u.requiredTech && (
                          <p className="text-[11px] font-semibold text-rose-700">
                            Requer {TECH_BY_ID[u.requiredTech].namePt}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'diplomacy' && (
            <div className="space-y-4">
              {/* Active Event */}
              {kingdomState.activeEvent && (
                <section
                  data-testid="active-event-card"
                  className="bg-amber-50 border-2 border-amber-500 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="text-[10px] font-bold uppercase text-amber-900">
                        Evento do Turno {kingdomState.activeEvent.turn}
                      </p>
                      <h3 className="font-display text-base font-bold text-[#1f1a12]">
                        {kingdomState.activeEvent.titlePt}
                      </h3>
                      <p className="text-xs text-[#3c3426] mt-0.5">
                        {kingdomState.activeEvent.descriptionPt}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {kingdomState.activeEvent.choices.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        data-testid={`event-choice-${choice.id}`}
                        onClick={() => onResolveEvent(choice.id)}
                        className="min-h-[48px] p-2.5 rounded-xl bg-white border-2 border-[#3c3426] text-left hover:bg-[#fcf9f2] cursor-pointer"
                      >
                        <span className="block text-xs font-bold text-[#1f1a12]">
                          {choice.labelPt}
                        </span>
                        <span className="block text-[11px] text-[#5c5140] mt-0.5">
                          {choice.descriptionPt}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Rival Factions */}
              <section className="space-y-2.5">
                <h3 className="font-display text-sm font-bold text-[#1f1a12] flex items-center gap-1.5">
                  <Handshake className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  Facções Vizinhas
                </h3>

                {kingdomState.factions.map((faction) => {
                  const tiles = countFactionTerritory(
                    kingdomState.worldState,
                    faction.id
                  );
                  const factionUnits = kingdomState.units.filter(
                    (u) => u.owner === faction.id && u.hp > 0
                  ).length;
                  const relationLabel =
                    faction.relation === 'hostile'
                      ? 'Hostil'
                      : faction.relation === 'trade_pact'
                        ? 'Acordo Comercial (+$20/t)'
                        : faction.relation === 'truce'
                          ? `Trégua (${faction.truceTurnsRemaining}t)`
                          : 'Neutra';

                  return (
                    <div
                      key={faction.id}
                      data-testid={`faction-card-${faction.id}`}
                      className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3.5 h-3.5 rounded-sm shrink-0 border border-black/20"
                            style={{ backgroundColor: faction.colorHex }}
                          />
                          <div className="min-w-0">
                            <p className="font-display text-sm font-bold text-[#1f1a12] truncate">
                              {faction.namePt}
                            </p>
                            <p className="text-[11px] text-[#5c5140] tabular-nums">
                              {tiles} territórios · {faction.population} hab · {factionUnits}{' '}
                              {factionUnits === 1 ? 'tropa' : 'tropas'} · {faction.unlockedTechs.length} techs
                            </p>
                            <p className="text-[11px] font-semibold text-[#3c3426] tabular-nums">
                              Tesouro {formatCash(faction.cash)} · Relação: {relationLabel}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {faction.relation !== 'truce' &&
                          faction.relation !== 'trade_pact' && (
                            <button
                              type="button"
                              data-testid={`diplomacy-truce-${faction.id}`}
                              onClick={() => onDiplomacy(faction.id, 'truce')}
                              className="min-h-[42px] px-3 rounded-lg bg-[#efe8d8] border border-[#c8ba9f] text-xs font-bold text-[#1f1a12] hover:bg-[#e5dcc7] whitespace-nowrap cursor-pointer"
                            >
                              Trégua ($220)
                            </button>
                          )}

                        {faction.relation !== 'trade_pact' && (
                          <button
                            type="button"
                            data-testid={`diplomacy-trade-${faction.id}`}
                            onClick={() => onDiplomacy(faction.id, 'trade_pact')}
                            className={`min-h-[42px] px-3 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${
                              faction.relation === 'hostile'
                                ? 'bg-[#efe8d8] border border-[#c8ba9f] text-[#6e604a]'
                                : 'bg-emerald-700 text-white hover:bg-emerald-800'
                            }`}
                          >
                            {faction.relation === 'hostile'
                              ? 'Comércio (requer Trégua)'
                              : 'Acordo Comercial ($300)'}
                          </button>
                        )}

                        {faction.relation !== 'hostile' && (
                          <button
                            type="button"
                            data-testid={`diplomacy-war-${faction.id}`}
                            onClick={() => onDiplomacy(faction.id, 'war')}
                            className="min-h-[42px] px-3 rounded-lg bg-rose-700 text-white text-xs font-bold hover:bg-rose-800 whitespace-nowrap cursor-pointer"
                          >
                            Declarar Guerra
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>

              {/* Recent Events History */}
              {kingdomState.eventHistory.length > 0 && (
                <section className="bg-white border border-[#d9ceb8] rounded-xl p-3.5 space-y-2">
                  <h3 className="font-display text-sm font-bold text-[#1f1a12]">
                    Histórico do Reino
                  </h3>
                  <div className="divide-y divide-[#ece4d3] text-xs">
                    {kingdomState.eventHistory.slice(0, 5).map((item, idx) => (
                      <div key={`${item.turn}-${idx}`} className="py-1.5">
                        <span className="font-bold text-[#1f1a12]">
                          T{item.turn} · {item.titlePt}:
                        </span>{' '}
                        <span className="text-[#5c5140]">{item.outcomePt}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
