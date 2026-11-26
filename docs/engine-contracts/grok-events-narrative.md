# Contrato — Events Narrative 2.0

**Branch:** `grok/events-narrative`  
**Status:** adaptador de resolução, schedules da cadeia, bloqueio de turno e persistência narrativa integrados; a geração espontânea contextual completa continua pendente.

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

## Compatibilidade legada e caminho atual

Os IDs de escolha legados continuam reconhecidos. O caminho ativo é:

`turn-engine.ts → generateTurnEvent()` (cadência clássica, agora com gates de contexto) → `KingdomState.activeEvent` → consumidores do HUD/modal → `resolveKingdomEvent()` → `resolveEventChoice()` → aplicação dos deltas ao reino.

`resolveKingdomEvent()` permanece como adaptador compatível para os consumidores existentes; o catálogo é a única fonte de consequências para IDs conhecidos. IDs desconhecidos permanecem pendentes em vez de serem descartados.

Follow-ups explicitamente agendados usam `generateContextualEvent()` quando chegam à data. Esse caminho continua verificando pré-condições e ignora somente o cooldown que bloquearia o próprio follow-up agendado. A geração periódica espontânea continua sujeita aos cooldowns.

`advanceKingdomTurn()` não avança enquanto existe `activeEvent`; o auto-turn da UI também pausa nessa condição. O save do reino inclui `narrativeState` (flags, cooldowns, schedules e crônica), mantendo compatibilidade com payloads antigos sem esse campo.

Preservados para consumidores legados:

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
- 42 escolhas encontradas nos arquivos importados (`events-catalog-data-a.ts` e `events-catalog-data-b.ts`)
- **Discrepância aberta:** o contrato recebido declara 48 escolhas, mas a soma executada do catálogo é 42. As seis escolhas ausentes não foram inventadas porque isso alteraria gameplay sem especificação.
- Cadeia completa `drought_arc` (3 passos: early_warning → harvest_fail → famine_crisis)
- Cooldowns, pesos, prioridades, condições (estação, fazendas, minas, comércio, conflito, afterChoice/Definition)
- Consequências imediatas + efeitos de mundo + flags + schedule de follow-ups
- Dilemas reais (ouro vs comida vs população vs ciência vs estabilidade vs risco futuro)
- Textos contextualizados (não genéricos)

## Imagens

Arquitetura pronta em `/public/event-images/` + `lib/event-images.ts`.  
SVGs placeholders temáticos. Substituíveis por WebP/PNG/AVIF sem alterar o motor.

## Etapa posterior

1. Decidir se a geração espontânea será migrada integralmente para `generateContextualEvent` ou se a cadência clássica será mantida.
2. Integrar a UI a imagens, raridade e crônica filtrada quando a etapa narrativa visual for autorizada.
3. Resolver a discrepância de seis escolhas com a fonte/autoria do catálogo antes de adicionar opções.

## Limitações conhecidas

- Textos ainda não interpolam dinamicamente valores numéricos do reino (descrições fixas ricas; contexto entra via condições de ativação).
- A integração de compatibilidade cobre schedules da cadeia; a substituição completa da cadência espontânea ainda não foi feita.
- SVGs são placeholders funcionais; assets finais de arte ficam para etapa posterior.
