# Contrato de Integração — Exploração & Tecnologia 2.0

**Agente responsável:** grok (Exploration + Tech 2.0)  
**Branch:** `grok/exploration-tech`  
**Arquivos:**

| Arquivo | Papel |
|---------|--------|
| `lib/exploration-engine.ts` | Motor de exploração, fog-of-war, descobertas e eventos |
| `lib/tech-engine.ts` | Árvore tecnológica 2.0 (IDs preservados) |
| `docs/engine-contracts/grok-exploration-tech.md` | Este contrato |

Nenhuma alteração foi feita em `kingdom-engine`, `turn-engine`, `hex-engine`, UI ou cena 3D.

---

## 1. Tecnologia 2.0

### 1.1 Estado serializável

```ts
interface ResearchState {
  unlocked: TechId[];
  activeTechId: TechId | null;
  progressScience: number;
}
```

- `createInitialResearchState()` — estado inicial (activeTechId = `'agriculture'`).
- `serializeResearchState` / `deserializeResearchState` — para saves.

### 1.2 Caminhos estratégicos

| Path | Techs (ordem) |
|------|----------------|
| `agricultura` | agriculture |
| `engenharia` | construction → engineering |
| `metalurgia` | mining → metallurgy |
| `comercio` | trade |
| `militar` | military |

Constantes: `TECH_PATHS`, `TECH_PATH_LABELS_PT`, `getAvailableTechsInPath`.

### 1.3 IDs preservados (compatibilidade de saves)

`agriculture | mining | construction | trade | metallurgy | engineering | military`

### 1.4 Efeitos concretos (`getTechModifiers`)

| Tech | Efeito numérico | Unlock |
|------|-----------------|--------|
| agriculture | food × 1.4 | building-mill |
| mining | stone/ore × 1.4 | building-mine |
| construction | buildCost × 0.85, +2 cap, +1 reach, +50 storage, +1 expl. range | building-village, unit-mansion |
| trade | gold × 1.35, +2 cap, +1 reach, +1 expl. range | building-port, warship |
| military | +1 expl. range | building-archery, building-tower, infantry, archer |
| metallurgy | ore × 1.3, +4 combat | building-smelter, unit-wall-tower, knight |
| engineering | +4 cap, +1 reach, −1 turn expansion, +80 storage, +1 expl. range | building-walls |

Helpers adicionais: `getUnlockedBuildings`, `getUnlockedUnits`.

### 1.5 Chamadas por turno

No pipeline de turno (passo de pesquisa):

```ts
const { nextResearch, completedTech } = advanceResearchProgress(
  state.research,
  scienceProducedThisTurn
);
```

Seleção manual:

```ts
const { nextResearch, selected } = selectActiveTech(state.research, techId);
```

---

## 2. Exploração

### 2.1 Estado serializável

```ts
interface ExplorationState {
  revealedKeys: string[];          // "q,r"
  claimedDiscoveries: ClaimedDiscovery[];
  activeExplorers: ActiveExplorer[];
  nextExplorerId: number;
  rangeBonus: number;
  rangeBonusTurnsRemaining: number;
  explorationCount: number;
}
```

- `createInitialExplorationState(initialOwnedCoords?)`
- `bootstrapExplorationFromWorld(worldState, actorId?)` — revela território próprio + vizinhos
- `serializeExplorationState` / `deserializeExplorationState`

### 2.2 Visibilidade territorial

| Estado | Significado |
|--------|-------------|
| `unknown` | Nunca revelado (névoa) |
| `explored` | Terreno/recursos conhecidos, neutro |
| `owned` | Pertence ao jogador (sempre visível) |
| `foreign` | Pertence a rival e já foi revelado |

```ts
getHexVisibility(exploration, worldState, q, r, actorId?)
isHexRevealed(exploration, q, r)
```

### 2.3 Regras de exploração (anti-grátis)

1. Alvo deve ser **adjacente** a pelo menos um hex já revelado.
2. Distância mínima até área revelada ≤ `effectiveRange` (base 2 + techs + bônus temporário).
3. Custo: ouro (`18 × ceil(distance)`) + alimento (`4 × ceil(distance)`).
4. Tempo: 1 turno base (+1 se distância ≥ 3).
5. Não se explora hex já revelado nem território próprio.
6. No máximo uma expedição por hex alvo.

```ts
const check = evaluateExploration({
  exploration, worldState, q, r,
  unlockedTechs, availableGold, availableFood
});
// check.canExplore, check.goldCost, check.foodCost, check.turnsRequired, ...
```

### 2.4 Iniciar expedição

```ts
const { nextExploration, started, check, explorer } = startExploration({...});
// Integrador deve debitar goldCost / foodCost dos recursos do reino
```

### 2.5 Avanço por turno

```ts
const resolution = advanceExplorationTurn({
  exploration, worldState, turn, unlockedTechs?
});
// resolution.nextState
// resolution.newlyRevealed: AxialCoord[]
// resolution.discoveries: ClaimedDiscovery[]
// resolution.event: ExplorationEvent | null
// resolution.rewardsApplied: DiscoveryReward  (gold, science, food, ...)
```

O integrador aplica `rewardsApplied` aos recursos / pesquisa e trata `event.riskCost` (ouro, população).

Ao completar, o alvo **e seus 6 vizinhos** são revelados (expansão suave de visão).

### 2.6 Descobertas únicas

Catálogo em `getDiscoveryCatalog()`. Cada `id` só pode ser claimado uma vez por campanha (`claimedDiscoveries`).

Tipos: `rare_resource`, `ruin`, `strategic_site`, `special_area`, `cache`.

Rare features do `terrain-engine` (`gold_vein`, `pure_iron`, …) geram descobertas correspondentes na primeira exploração do hex.

### 2.7 Eventos de exploração

Rolados de forma determinística a partir de `explorationCount` + distância:

| kind | Efeito típico |
|------|----------------|
| nothing | Sem efeito |
| friendly_natives | +food, +science |
| resource_cache | +gold, +wood, +ore |
| ancient_map | +science, +range temporário |
| lost_party | −gold |
| ambush | −gold, −population |

---

## 3. Integração sugerida (outro agente)

1. **Bootstrap**  
   Ao criar / carregar `KingdomState`, inicializar:

   ```ts
   exploration: bootstrapExplorationFromWorld(state.worldState)
   ```

   (ou deserializar do save).

2. **Persistência**  
   Incluir `serializeExplorationState` e `serializeResearchState` no blob de save.

3. **Por turno** (após economia / antes ou depois de research):

   ```ts
   const expRes = advanceExplorationTurn({ exploration, worldState, turn });
   // aplicar rewards → resources / research.progressScience
   // aplicar riskCost → gold / population
   exploration = expRes.nextState;
   ```

4. **Ação do jogador “Explorar hex”**  
   `evaluateExploration` → se ok, debitar custos → `startExploration`.

5. **UI / fog**  
   Usar `getHexVisibility` / `isHexRevealed` para esconder tiles `unknown` na cena 3D e no HUD.  
   Não requer alteração neste agente.

6. **Tech UI**  
   Agrupar por `path` com `TECH_PATHS` / `TECH_PATH_LABELS_PT`.  
   Mostrar `effectsSummaryPt` e prédios/unidades desbloqueados.

---

## 4. Dependências existentes reutilizadas

- `hex-engine`: `hexKey`, `AxialCoord`, `HexWorldState`, `HexOwner`
- `terrain-engine`: terreno, recursos, `RareFeatureType`, `getStrategicRegionInfo`
- `territory-engine`: `axialDistance`, `AXIAL_DIRECTIONS`, `getAxialNeighbors`
- IDs de construção / unidades já usados pelo catálogo e military-engine

Nenhum sistema duplicado. Expansão territorial (conquer) permanece em `territory-engine`; exploração apenas revela informação.

---

## 5. Limitações atuais

- O motor de exploração **não** está ligado ao `KingdomState` nem ao `turn-engine` (integração futura).
- Recompensas e custos de risco são retornados para o integrador aplicar; o exploration-engine não muta recursos do reino.
- Fog visual na cena 3D depende do agente de UI.
- Não há pathfinding de exploradores no mapa (movimento abstrato por distância axial).
