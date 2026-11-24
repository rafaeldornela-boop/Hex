'use client';

import { useState } from 'react';
import {
  Check,
  Coins,
  FlaskConical,
  Handshake,
  Lock,
  Shield,
  Sparkles,
  Swords,
  Users,
  X,
} from 'lucide-react';
import type { TurnProductionBreakdown, KingdomStageInfo } from '@/lib/economy-engine';
import { countFactionTerritory } from '@/lib/faction-engine';
import type { KingdomState } from '@/lib/kingdom-engine';
import { UNIT_CATALOG, type UnitEntity } from '@/lib/military-engine';
import { TECH_BY_ID, TECH_TREE, canStartResearch, type TechId } from '@/lib/tech-engine';

export type KingdomModalTab = 'economy' | 'research' | 'military' | 'diplomacy';

export interface KingdomModalProps {
  open: boolean;
  initialTab?: KingdomModalTab;
  kingdomState: KingdomState;
  economy: TurnProductionBreakdown;
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
  stage,
  militaryPower,
  onClose,
  onSelectTech,
  onResolveEvent,
  onDiplomacy,
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

  const tabs: Array<{ id: KingdomModalTab; label: string; alert?: boolean }> = [
    { id: 'economy', label: 'Economia' },
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
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Em Obras / Tropas</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {economy.population.usedWorkers}
                    </p>
                  </div>
                  <div className="bg-[#f7f2e6] rounded-lg p-2.5">
                    <p className="text-[10px] font-bold uppercase text-[#6e604a]">Crescimento</p>
                    <p className="mt-0.5 font-display text-base font-bold text-[#1f1a12]">
                      {formatSigned(economy.population.projectedGrowth)} / turno
                    </p>
                  </div>
                </div>
              </section>

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
                          ? ` · Comércio +${formatCash(economy.goldTradePactBonus)}`
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
                    <span className="font-semibold text-[#2a2319]">Minério</span>
                    <div>
                      <span className="font-bold text-[#1f1a12] mr-3">
                        {kingdomState.resources.ore} / {economy.storageCaps.ore}
                      </span>
                      <span className="font-bold text-emerald-700">
                        {formatSigned(economy.oreNet)}/turno
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
                              {tiles} territórios · Relação: {relationLabel}
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
