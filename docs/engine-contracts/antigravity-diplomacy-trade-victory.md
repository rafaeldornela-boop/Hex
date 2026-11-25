# Contrato de Arquitetura e Integração — Diplomacia 2.0, Comércio Internacional, Militar 2.0 e Condições de Vitória

Este documento define o contrato público das camadas de backend implementadas na branch `antigravity/diplomacy-trade-victory`. Nenhuma alteração foi feita em componentes de interface (`components/**`), cena 3D ou nos motores centrais de economia, território, hexágono, tecnologia ou turno.

---

## 1. Visão Geral dos Módulos

| Arquivo | Responsabilidade Principal |
| --- | --- |
| `lib/military-engine.ts` | Logística militar, alcance de suprimentos, atrito, movimentação viária, fortificação/guarnição, escolta de rotas, inteligência militar, dano proporcional e recuperação pós-conflito. |
| `lib/interfaction-trade-engine.ts` | Rotas comerciais terrestres/marítimas entre reinos, oferta/demanda e preços dinâmicos, tarifas, infraestrutura (estradas, mercados, portos, módulos), bloqueios/embargos e comércio direto (*spot*). |
| `lib/victory-engine.ts` | Avaliação objetiva e transparente das 6 condições de vitória (`territorial`, `economic`, `technological`, `urban`, `diplomatic`, `military`) e 3 condições justas de derrota (`conquered`, `capital_lost`, `total_collapse`). |
| `lib/kingdom-engine.ts` | Orquestração de Diplomacia 2.0, wrappers públicos de estado, efeitos econômicos de danos de guerra, ciclo completo por turno (`advanceKingdomTurn`) e persistência compatível no formato v10. |

---

## 2. Diplomacia 2.0 (`lib/kingdom-engine.ts`)

### 2.1 Tipos Públicos Exportados

- `DiplomaticStance`: `'hostile' | 'wary' | 'neutral' | 'friendly' | 'allied'`
- `TreatyState`:
  - `peaceTreatyTurns: number`
  - `nonAggressionTurns: number`
  - `tradePact: boolean`
  - `alliance: boolean`
  - `truceTurnsRemaining: number`
  - `warReparationsPerTurn: number`
  - `reparationsDirection: 'player_receives' | 'player_pays' | null`
  - `reparationsTurnsRemaining: number`
  - `embargoActive: boolean`
- `DiplomacyHistoryEvent`: `{ turn: number; labelPt: string; deltaTrust: number }`
- `FactionDiplomacyState`: estado completo por facção (`factionId`, `stance`, `trustScore` `-100..+100`, `atWar`, `conflictCount`, `turnsSinceLastConflict`, `borderFrictionScore`, `tradeGoodwillScore`, `militaryBalanceDelta`, `betrayalPenalty`, `treaties`, `history`, `lastStanceReasonPt`).
- `DiplomacyActionType`:
  - `'truce' | 'trade_pact' | 'war' | 'peace_treaty' | 'non_aggression' | 'alliance' | 'resource_aid' | 'territorial_concession'`
- `DiplomacyActionPayload`: `{ resource?: 'wood' | 'stone' | 'food' | 'ore' | 'metal'; amount?: number; coord?: AxialCoord }`
- `DiplomacyEvaluation`: visão pronta para UI (`factionId`, `factionNamePt`, `stance`, `stanceLabelPt`, `trustScore`, `atWar`, `borderFrictionScore`, `tradeGoodwillScore`, `betrayalPenalty`, `treaties`, `lastStanceReasonPt`, `recentHistory`).

### 2.2 Funções Públicas

- `getKingdomDiplomacySummary(state: KingdomState)`
  - **Retorno**: `{ evaluations: DiplomacyEvaluation[]; activeWarsCount: number; tradePactCount: number; allianceCount: number }`
- `performDiplomacyAction(state: KingdomState, factionId: string, action: DiplomacyActionType, payload?: DiplomacyActionPayload)`
  - **Retrocompatibilidade garantida**: chamadas antigas com `'truce' | 'trade_pact' | 'war'` mantêm assinaturas e custos originais (`$220`, `$300`, guerra gratuita) e atualizam `factions[].relation` junto com `diplomacyByFactionId`.
  - **Novas ações**:
    - `'peace_treaty'`: encerra guerra formalmente por 6 turnos; se poder militar do jogador for `>= 1.25x` do rival, isenta taxa do jogador e impõe reparações (`+$25/turno` por 4 turnos); caso contrário cobra `$160`.
    - `'non_aggression'`: custo `$140`, requer ausência de guerra/hostilidade, dura 8 turnos e reduz risco de atrito fronteiriço.
    - `'alliance'`: custo `$350`, requer `!atWar`, `betrayalPenalty > -30` e `trustScore >= 35` (ou `tradePact && nonAggressionTurns > 0`), eleva postura para `'allied'` e habilita trânsito de suprimentos aliado.
    - `'resource_aid'`: transfere recursos reais do estoque do jogador para o estoque da facção parceira, somando confiança (`+6..+18`).
    - `'territorial_concession'`: transfere um hexágono periférico não-capital (`payload?.coord` ou o mais próximo da capital rival) ao parceiro, encerra guerra ativa e adiciona `+28` confiança.
  - **Quebra de tratado e reação geopolítica**: atacar ou declarar guerra com trégua/paz/não-agressão/aliança ativa aplica `betrayalPenalty` pesado na vítima (`-15` a `-35`) e penalidade de confiança (`-10`) em todas as demais facções.
- Utilitários exportados: `createInitialDiplomacyMap`, `normalizeDiplomacyMap`, `stanceFromLegacyRelation`, `legacyRelationFromDiplomacy`, `getDiplomaticStanceLabelPt`, `recalculateFactionStance`, `appendDiplomacyHistory`.

---

## 3. Comércio Internacional entre Facções (`lib/interfaction-trade-engine.ts` + `lib/kingdom-engine.ts`)

### 3.1 Tipos Públicos Exportados

- `RouteTransportMode`: `'land' | 'maritime'`
- `InternationalRouteStatus`: `'active' | 'disrupted' | 'embargoed' | 'suspended'`
- `InternationalTradeRoute`: rota ativa/pausada com `id`, `partnerFactionId`, `mode`, `status`, `exportResource`, `exportAmount`, `importResource`, `importAmount`, `pathCoords`, `connectivityScore`, `securityScore`, `tariffRatePct`, `totalValueTradedGold`, `successfulTurns`, `disruptedTurnsRemaining`, `interruptionReasonPt`.
- `FactionResourceProfile` & `ResourceMarketBalance`: classificação por recurso (`'excedente' | 'equilibrado' | 'escassez'`) e pontuação `-100..+100`.
- `BilateralPriceQuote`: preços bilaterais dinâmicos de importação (`importUnitCostGold`), exportação (`exportUnitRevenueGold`), tarifa efetiva e leitura estratégica (`strategicFitLabelPt`).
- `TradeInfrastructureSummary`: contagem de mercados, portos, docas, estradas/cidades conectadas, faróis, bolsas e capacidade máxima simultânea (`landRouteCapacity`, `maritimeRouteCapacity`, `totalRouteCapacity`).
- `InterfactionTradeState` & `InterfactionMarketSnapshot` & `InterfactionTradeTurnOutcome`.

### 3.2 Funções de Domínio (`interfaction-trade-engine.ts`) e Wrappers (`kingdom-engine.ts`)

- Leitura para HUD (sem mutação):
  - `getKingdomInterfactionTradeSummary(state, assets): InterfactionMarketSnapshot`
  - `evaluateTradeInfrastructure(...)`, `analyzeFactionResourceBalances(...)`, `quoteBilateralResourcePrices(...)`, `computeBilateralTariffPct(...)`, `computeRoutePathCoords(...)`, `canOpenInternationalRoute(...)`.
- Ações para UI:
  - `openTradeRouteInKingdom(state, { partnerFactionId, mode, exportResource, exportAmount?, importResource, importAmount? }, assets)`
    - Exige relação não hostil/embargada; modo `'maritime'` exige `building-port` ou `building-dock` concluído e respeita limite de capacidade.
  - `closeTradeRouteInKingdom(state, routeId)`
  - `tradeWithFactionInKingdom(state, { partnerFactionId, action: 'buy' | 'sell', resource, amount }, assets)`
    - Executa compra/venda imediata transferindo recursos e ouro reais entre `state.resources`/`worldState.cash` e `faction.resources`/`faction.cash`, gerando ganho de confiança bilateral.
- Regras de risco e bloqueio:
  - `embargoFactionRoutes`: alterna rotas para `'embargoed'` imediatamente ao iniciar guerra e libera quando paz/trégua é firmada.
  - `disruptRoutesNearCoord`: suspende rotas por N turnos quando ocorre batalha ou conquista num raio próximo à rota.
  - Interceptação determinística por turno: rotas vulneráveis (`securityScore < 70`) próximas de unidades hostis ou rotas marítimas sem `port_lighthouse` sob tempestade entram em `'disrupted'`; escoltas (`protectionScore >= 75` via fortes/tropas) protegem a rota e geram bônus de segurança.

---

## 4. Sistema Militar 2.0 e Consequências dos Conflitos (`lib/military-engine.ts` + `lib/kingdom-engine.ts`)

### 4.1 Tipos Públicos Exportados

- `UnitSupplyStatus`: `'supplied' | 'strained' | 'unsupplied'`
- `ThreatLevel`: `'baixo' | 'moderado' | 'alto' | 'critico'`
- `DamagedHexRecord`: registro por hex (`key`, `q`, `r`, `damagePct`, `productionPenaltyPct`, `defensePenalty`, `turnsRemaining`, `repairCost`, `reasonPt`, `lastConflictTurn`).
- `UnitSupplyReport` & `ArmyLogisticsSummary`
- `FortificationReport`
- `RouteProtectionReport`
- `FactionMilitaryIntelligence`
- `ConflictDamageOutcome` & `CombatResolution`

### 4.2 Funções Públicas

- Alcance e Movimentação:
  - `getUnitMovementAllowance(unit, worldState, unlockedTechs?, roads?)`
  - `getReachableUnitCoords({ unit, worldState, units, assets, unlockedTechs?, roads?, underConstructionKeys?, canAttackOwner? })`
    - Suporta alcance expandido de cavalaria (`knight`), navios com `'trade'`, estradas Nív. 2+, trânsito através de unidades aliadas/próprias e validação de água/pontes.
- Logística e Suprimentos:
  - `evaluateUnitSupply(...)` e `evaluateFactionLogistics(...)` (wrapper: `getKingdomMilitaryLogistics(state, assets)`)
    - Calcula distância até hubs operacionais (`building-castle`, `building-village`, `building-port`, etc.), bônus de estradas conectadas, módulos (`mil_armory`, `mil_beacon`, `port_lighthouse`), trânsito aliado (`alliedOwners`) e impacto de `foodDeficitTurns`.
    - Unidades `'strained'` sofrem `-15%` ataque e `+$1` manutenção extra; `'unsupplied'` sofrem `-30%` ataque, `+$2` manutenção extra e atrito de `-3 HP/turno`.
- Defesa Territorial & Inteligência:
  - `evaluateHexFortification(...)` (wrapper: `getKingdomHexFortification(state, q, r, assets)`) / `computeHexDefenseScore(...)` / `computeNeighborFortificationBonus(...)`
    - Soma defesa estrutural, upgrades, módulos, aura de bastiões/torres vizinhas (`+2` por adjacente, máx `+4`), guarnição entrincheirada, cobertura de arqueiros adjacentes (`+2`), deduzindo `damagePenalty`.
  - `evaluateRouteMilitaryProtection(...)`
  - `computeMilitaryIntelligence(...)` (wrapper: `getKingdomMilitaryIntelligence(state, assets)`)
    - Calcula precisão de reconhecimento (`40%..100%` via torres, faróis, batedores e pactos), nível de ameaça e hexes de fronteira vulneráveis.
- Consequências e Reconstrução:
  - `commandUnitInKingdom(state, from, to, assets)`: além da movimentação estendida e combate com logística, aplica `createConflictDamageForTile` em `damagedHexes`, coleta `lootResources` (quando capturado), interrompe rotas comerciais vizinhas e registra histórico/traição diplomática.
  - `repairDamagedHexInKingdom(state, q, r)`: consome `record.repairCost` (ouro/madeira/pedra) e remove o dano imediatamente.
  - `stepDamagedTilesRecovery(damagedHexes, isAtWarWithOwner)`: recuperação gradual automática (`-4%` em guerra / `-10%` em paz por turno).

---

## 5. Condições de Vitória e Derrota (`lib/victory-engine.ts`)

### 5.1 Tipos e Constantes Exportadas

- `VictoryPathId`: `'territorial' | 'economic' | 'technological' | 'urban' | 'diplomatic' | 'military'`
- `DefeatReasonId`: `'capital_lost' | 'conquered' | 'total_collapse'`
- `MatchStatus`: `'ongoing' | 'victory' | 'defeat'`
- `VICTORY_THRESHOLDS`: limiares objetivos verificáveis de cada condição.
- `VictoryProgressSnapshot` (wrapper: `getKingdomVictoryProgress(state, assets)`): lista todos os 6 caminhos com `progressPct` (`0..100`), `achieved`, `milestones` individuais (`current` vs `target`), `leadingPathId`, `activeWarningsPt` e `defeatEvaluation`.

### 5.2 Critérios Objetivos das 6 Vitórias

1. **Territorial (`territorial`)**: `>= 28` hexes sob domínio, `>= 55%` das terras reivindicadas do mundo (mínimo 18 hexes) e `>= 3` cidades administradas.
2. **Econômica (`economic`)**: tesouro `>= $4000`, superávit líquido `>= $120/turno`, tecnologia `'trade'` + `>= 2` mercados/portos operacionais e (`>= 2` rotas comerciais ativas OU `>= $1200` acumulados em exportações).
3. **Tecnológica (`technological`)**: `7/7` tecnologias desbloqueadas (`TECH_TREE.length`), ciência `>= 24/turno` e ao menos `1` polo acadêmico (`building-wizard-tower`, `castle_royal_archive` ou módulo `acad_*`).
4. **Urbana (`urban`)**: população `>= 55`, `>= 3` cidades fundadas, ao menos `1` cidade Nív. 4+ com `urbanQualityScore >= 5` e `>= 2` cidades conectadas por estradas.
5. **Diplomática (`diplomatic`)**: `>= 1` facção rival sobrevivente, `0` guerras ativas, `100%` dos sobreviventes em postura `'friendly'` ou `'allied'`, todos sob algum tratado ativo, confiança média `>= 65` e ao menos `1` Aliança formal.
6. **Domínio Militar (`military`)**: todas as capitais rivais rastreadas conquistadas ou facções zeradas no mapa, `>= 4` unidades ativas com prontidão logística `>= 65%` e razão ofensiva `>= 2.0x` frente a eventuais forças rivais remanescentes.

### 5.3 Critérios Justos de Derrota

- **`conquered`**: jogador fica com `0` territórios no mapa.
- **`capital_lost`**: capital do jogador perdida; emite alerta claro no 1º turno e só encerra no 2º turno consecutivo sem retomada (`capitalLostStreak >= 2`) ou se não houver cidades restantes.
- **`total_collapse`**: tesouro zerado com saldo negativo (`goldNet < 0`), estoque de alimento zerado e `foodDeficitTurns >= 4` mantidos por `3` turnos consecutivos (`economicCollapseStreak >= 3`), com avisos prévios nos turnos 1 e 2.

---

## 6. Dados Persistidos em `KingdomState` (Save Version 10)

O campo `version` permanece `10` em `serializeKingdomState` para preservar 100% de compatibilidade com saves existentes. Os novos campos opcionais adicionados ao payload v10 e normalizados em `deserializeKingdomState` (inclusive para saves legados v1–v10 sem esses campos) são:

1. `diplomacyByFactionId?: Record<string, FactionDiplomacyState>` — posturas, histórico, confiança, atrito, penalidades de quebra de pactos e tratados (`peaceTreatyTurns`, `nonAggressionTurns`, `tradePact`, `alliance`, reparações, embargo).
2. `interfactionTrade?: InterfactionTradeState` — rotas (`routes`), sequencial de IDs (`nextRouteSeq`), volumes históricos e saldo comercial do último turno.
3. `damagedHexes?: Record<string, DamagedHexRecord>` — danos locais em construção/defesa e custo de reparo por coordenada.
4. `victoryState?: PersistedVictoryState` — status da partida (`status`, `achievedVictoryId`, `defeatReason`, `resolvedTurn`), capitais rivais rastreadas inicialmente (`trackedRivalCapitals`) e contadores de janela de aviso (`capitalLostStreak`, `economicCollapseStreak`).

---

## 7. Fluxo por Turno (`advanceKingdomTurn`) e Comunicação entre Motores

Como `lib/turn-engine.ts` e `lib/economy-engine.ts` permanecem intocados, `advanceKingdomTurn` em `lib/kingdom-engine.ts` coordena todo o ciclo mantendo consistência causal e sem duplicar efeitos:

1. **Pré-processamento antes de `processKingdomTurn`**:
   - Sincroniza `diplomacyByFactionId -> factions[].relation` e `truceTurnsRemaining` (garantindo que AI em `faction-engine.ts` respeite tréguas/tratados de paz).
   - Agrega penalidades produtivas dos setores do jogador presentes em `damagedHexes` em um efeito transitório único (`eff-war-damage-sync`, que também é aplicado em `getKingdomEconomy` sobre `buildingsByKey[k]`).
2. **Pipeline Base (`processKingdomTurn`)**: executa calendário, clima, construções/módulos, economia, população, pesquisa, cidades/estradas e ações das facções rivais.
3. **Pós-processamento em cadeia**:
   - Remove `'eff-war-damage-sync'` do array persistido de `activeEffects` para evitar acúmulo no save.
   - **Militar 2.0**: executa `applySupplyConsequencesToUnits` (descontando manutenção extra de suprimentos estendidos e aplicando atrito de HP em tropas isoladas/famintas) e `stepDamagedTilesRecovery`.
   - **Comércio Internacional**: executa `advanceInterfactionTradeTurn` usando `storageCaps` e `roadConnectivity` vindos do `economy-engine` / `road-engine`, movimentando estoques e ouro reais e somando confiança diplomática às rotas bem-sucedidas.
   - **Diplomacia 2.0**: executa `advanceDiplomacyTurnStep` liquidando reparações de guerra, detectando conquistas/agressões da IA (`conqueredByAiKeys`), aplicando danos de conflito e bloqueio de rotas próximos a ataques sofridos, recalculando atrito fronteiriço (território próximo a capitais rivais) e evoluindo posturas/tratados.
   - **Condições de Vitória/Derrota**: executa `evaluateVictoryAndDefeat(..., { advanceStreaks: true })` integrando `economy-engine`, `territory-engine`, `tech-engine`, `city-engine`, `interfaction-trade-engine` e `military-engine`, atualizando `victoryState` e compondo o resumo do turno (`headlinePt`).
