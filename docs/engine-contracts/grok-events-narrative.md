# Contrato — Events Narrative 2.0

**Branch:** `grok/events-narrative`

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `lib/events-engine.ts` | Catálogo, geração, resolução, crônica |
| `lib/event-images.ts` | Catálogo de imagens temáticas |
| `public/event-images/*.svg` | Placeholders SVG substituíveis por WebP/PNG |
| `lib/events-engine.test.ts` | Testes |

## Compatibilidade legada

Preservados para `turn-engine` / `kingdom-engine`:

- `generateTurnEvent(turn, borderTarget?)`
- `KingdomEventKind` (estendido)
- `ActiveKingdomEvent`, `EventChoiceOption`, `ActiveWorldEffect`, `EventHistoryEntry`
- Choice IDs clássicos (`irrigate_fields`, `accept_drought`, `store_food`, …)

## Novas APIs

```ts
generateContextualEvent(ctx: EventWorldContext): ActiveKingdomEvent | null
resolveEventChoice(event, choiceId, { turn, gold, defensePower }): EventResolution
createInitialNarrativeState()
applyResolutionToNarrative(narrative, resolution, turn)
serializeNarrativeState / deserializeNarrativeState
getEventImage(category)
getEventCatalogStats()
```

`EventResolution.chronicleWorthy` controla o que entra na Crônica do Reino (crises, raros, invasões, diplomacia, fim de cadeia).

## Integração futura (Antigravity)

1. Preferir `generateContextualEvent` com snapshot do reino.
2. `resolveKingdomEvent` → delegar a `resolveEventChoice` e aplicar deltas.
3. Persistir `NarrativeState` no save.
4. UI: `imageSrc`, raridade, crônica.

Não alterar UI/turn/kingdom neste branch.
