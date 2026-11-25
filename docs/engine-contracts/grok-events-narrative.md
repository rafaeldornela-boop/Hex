# Contrato — Events Narrative 2.0

**Agente:** grok  
**Branch:** `grok/events-narrative`  
**Arquivos principais:**

| Arquivo | Papel |
|---------|--------|
| `lib/events-engine.ts` | Catálogo, geração, resolução, crônica |
| `lib/event-images.ts` | Biblioteca estática de imagens temáticas |
| `public/event-images/*.svg` | Assets visuais reutilizáveis |
| `lib/events-engine.test.ts` | Testes |

Não altera `HexWorldGame.tsx`, `HexSceneController.ts`, `GameHud.tsx`, economia, militar, tech ou exploração.

---

## Compatibilidade

APIs legadas **preservadas** (usadas por `turn-engine` e `kingdom-engine`):

```ts
generateTurnEvent(turn, borderTarget?) → ActiveKingdomEvent | null
type KingdomEventKind  // estendido com novos kinds
type ActiveKingdomEvent // campos opcionais novos
type EventChoiceOption
type ActiveWorldEffect
type EventHistoryEntry
```

Choice IDs clássicos (`irrigate_fields`, `accept_drought`, `store_food`, …) **permanecem** para `resolveKingdomEvent` em `kingdom-engine.ts` continuar funcionando.

---

## Novas APIs

### Geração contextual

```ts
generateContextualEvent(ctx: EventWorldContext): ActiveKingdomEvent | null
```

### Resolução data-driven

```ts
resolveEventChoice(event, choiceId, { turn, gold, defensePower }): EventResolution
```

### Estado narrativo

```ts
createInitialNarrativeState()
applyResolutionToNarrative(narrative, resolution, turn, importance?)
serializeNarrativeState / deserializeNarrativeState
```

### Imagens

```ts
getEventImage(category) → { src, labelPt, accentHex }
// src: '/event-images/<category>.svg'
```

---

## Integração sugerida

1. Preferir `generateContextualEvent` com snapshot do reino; manter `generateTurnEvent` como fallback.
2. `resolveKingdomEvent` deve delegar para `resolveEventChoice` e aplicar deltas + narrative state.
3. Persistir `NarrativeState` no save.
4. UI: `imageSrc`, `category`, `rarity`, crônica.

## Limitações

- resolveKingdomEvent ainda não delega automaticamente.
- SVGs são placeholders temáticos.
- Áudio/animações fora de escopo.
