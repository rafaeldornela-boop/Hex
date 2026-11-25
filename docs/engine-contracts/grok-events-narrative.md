# Contrato — Events Narrative 2.0

**Branch:** `grok/events-narrative`  
**Status:** motor isolado, testado, pronto para integração gradual pela Antigravity.

## Arquivos entregues

| Arquivo | Papel |
|---------|--------|
| `lib/events-engine.ts` | Geração contextual, resolução, crônica, estado narrativo |
| `lib/events-catalog-types.ts` | Tipos compartilhados |
| `lib/events-catalog-data-a.ts` | Catálogo parte A (cadeia seca + clássicos) |
| `lib/events-catalog-data-b.ts` | Catálogo parte B (sazonais, raros, diplomáticos, etc.) |
| `lib/events-catalog-data.ts` | Agregação do catálogo |
| `lib/events-catalog.ts` | Re-export do catálogo e tipos |
| `lib/event-images.ts` | Biblioteca de imagens temáticas |
| `public/event-images/*.svg` | Placeholders SVG (20 categorias) |
| `lib/events-engine.test.ts` | Testes de ativação, cooldown, cadeia, resolução, persistência |

## Compatibilidade legada

Preservados para `turn-engine` / `kingdom-engine` (não alterados neste branch):

- `generateTurnEvent(turn, borderTarget?)` — cadência a cada 3 turnos a partir do turno 3
- `KingdomEventKind` (estendido)
- `ActiveKingdomEvent`, `EventChoiceOption`, `ActiveWorldEffect`, `EventHistoryEntry`
- Choice IDs clássicos: `irrigate_fields`, `accept_drought`, `store_food`, `sell_surplus`, `extract_minerals`, `study_findings`, `invest_caravan`, `decline_caravan`, `fund_healers`, `quarantine_only`, `stabilize_treasury`, `absorb_crisis`, `tax_relief`, `suppress_revolt`, `sponsor_academy`, `sell_manuscripts`, `defend_borders`, `pay_tribute`

## Novas APIs

```ts
generateContextualEvent(ctx: EventWorldContext): ActiveKingdomEvent | null
resolveEventChoice(event, choiceId, { turn, gold, defensePower }): EventResolution
createInitialNarrativeState(): NarrativeState
applyResolutionToNarrative(narrative, resolution, turn, importance?)
serializeNarrativeState / deserializeNarrativeState
getEventImage(category)
getEventCatalogStats()
listEventDefinitions() / getEventDefinition(id)
```

`EventResolution.chronicleWorthy` controla o que entra na Crônica do Reino (crises, raros, lendários, invasões, diplomacia, fim de cadeia).

## Conteúdo do catálogo

- 21 eventos cobrindo: comuns, sazonais, econômicos, políticos, diplomáticos, militares, exploração, tecnológicos, positivos, raros, crises
- 48 escolhas
- Cadeia completa `drought_arc` (3 passos: early_warning → harvest_fail → famine_crisis)
- Cooldowns, pesos, prioridades, condições (estação, fazendas, minas, comércio, conflito, afterChoice/Definition)
- Consequências imediatas + efeitos de mundo + flags + schedule de follow-ups
- Dilemas reais (ouro vs comida vs população vs ciência vs estabilidade vs risco futuro)
- Textos contextualizados (não genéricos)

## Imagens

Arquitetura pronta em `/public/event-images/` + `lib/event-images.ts`.  
SVGs placeholders temáticos. Substituíveis por WebP/PNG/AVIF sem alterar o motor.

## Integração futura (Antigravity)

1. Preferir `generateContextualEvent` com snapshot do reino (estação, comida, ouro, defesa, flags, scheduled, cooldowns).
2. `resolveKingdomEvent` → delegar a `resolveEventChoice` e aplicar deltas/efeitos.
3. Persistir `NarrativeState` no save do reino.
4. UI: `imageSrc`, raridade, crônica filtrada.

**Não alterar neste branch:** UI, turn-engine, kingdom-engine, economia, militar, etc.

## Limitações conhecidas

- Textos ainda não interpolam dinamicamente valores numéricos do reino (descrições fixas ricas; contexto entra via condições de ativação).
- Integração com save/turn pipeline ainda não feita (por design).
- SVGs são placeholders funcionais; assets finais de arte ficam para etapa posterior.
