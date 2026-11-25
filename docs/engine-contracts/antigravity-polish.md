# Contrato de Polimento — Áudio, Animações, UX Mobile & Balanceamento

**Agente responsável:** antigravity  
**Branch:** `antigravity/polish-audio-animation-mobile-balance`  

---

## 1. Sistema Centralizado de Áudio (`lib/game-audio.ts`)

- **Arquitetura 100% Web Audio API procedural:** Zero arquivos `.mp3`/`.wav` pesados, carregamento sob demanda na primeira interação (`unlockAndStartAtmosphere()`), sem 404s.
- **Controle de Polifonia e Rate Limiting:** Cooldowns por som (45–500 ms) e teto simultâneo de 8 vozes SFX (`maxSfxVoices = 8`) evitando sobrecarga sonora.
- **Efeitos Sonoros Implementados:**
  - Interface: `playUiClick`, `playCycle`, `playRotate`, `playSaveChime`
  - Construção e Evolução: `playPlace`, `playBuildStart`, `playBuildComplete`, `playUpgrade`, `playModuleInstall`, `playDemolish`
  - Estratégia e Eventos: `playDiscovery`, `playConquest`, `playTrade`, `playDecision`, `playDiplomacy`, `playSpecialEvent`, `playTurnAdvance`, `playSeasonChange`
  - Estados Finais & Erros: `playVictory`, `playDefeat`, `playError`
- **Música Adaptativa (`MusicState`):**
  - 5 estados: `normal`, `prosperity`, `crisis`, `war`, `discovery`.
  - Função pura `resolveAdaptiveMusicState(ctx)` determina o estado a partir do estado global do reino.
  - Transições suaves via `setTargetAtTime` (~1.6 s) e histerese (`musicHoldMs = 12000 ms`) para não trocar música a cada turno.
- **Som Ambiente (`AmbientBiome`):**
  - Camadas sutis por filtro passa-banda para `forest`, `water`, `city`, `mining`, `port`, `rain`, `storm`, `night`.
  - Opção dedicada para desligar/reduzir ambiente, com volume inicial mais suave em telas táteis (`pointer: coarse`).
- **Preferências Persistidas (`localStorage`):**
  - Chave: `hex_audio_accessibility_prefs_v1`.
  - Campos: `masterVolume`, `musicVolume`, `sfxVolume`, `ambientVolume`, `muted`, `ambientEnabled`, `reduceAnimations`, `reduceEffects`, `textSize` (`normal` | `large`).

---

## 2. Animações, Feedback Visual e Acessibilidade (`HexSceneController.ts`, `HexWorldGame.tsx`, `app/globals.css`)

- **Efeitos 3D Restritos e Informativos:**
  - Método `triggerEventEffect(kind, coord)` usa o pool instanciado existente (`particlesMesh`) e anéis compartilhados (`conquestRingGeo`) para sinalizar: `build_complete`, `upgrade`, `module`, `road`, `city`, `discovery`, `conquest`, `event`.
  - `HexWorldGame.tsx` dispara feedback visual e sonoro sincronizado ao concluir obras, evoluir prédios/módulos, fundar cidades, mudar estação ou resolver eventos.
- **Performance:**
  - Mantidos `InstancedMesh` para terreno/partículas, geometrias e materiais compartilhados (`getSharedUpgradeGeo`) e loop sob demanda (`wakeRenderLoop`).
- **Acessibilidade:**
  - `setAccessibilityOptions({ reduceAnimations, reduceEffects })` no `HexSceneController` desativa oscilações contínuas e reduz/omite partículas e ondas quando solicitado.
  - Atributos `data-reduce-animations` e `data-text-size` no contêiner raiz (`app/globals.css`) ajustam transições CSS (`hex-panel-enter`) e escala tipográfica.

---

## 3. UX Mobile e Eventos (`GameHud.tsx`, `KingdomModal.tsx`)

- **Painel de Áudio & Acessibilidade no Menu (`audio-accessibility-panel`):**
  - Controles deslizantes para Geral, Música, Efeitos e Ambiente, além de botões táteis (`min-h-[44px]`) para Ambiente On/Off, Texto Normal/Grande, Reduzir Animações e Reduzir Efeitos.
- **Eventos de Decisão Mobile (`active-event-card`):**
  - Hierarquia visual reforçada com emblema contextual, título destacado, descrição legível e botões grandes (`min-h-[58px]`) em coluna única para uso confortável com uma mão, exibindo consequências diretamente.

---

## 4. Balanceamento & Simulação Automática (`lib/balance-simulation.ts`, `lib/balance-simulation.test.ts`)

- **Auditoria em 192 turnos (Checkpoints 12, 24, 48, 96, 144, 192)** em 5 estratégias (`agricola`, `minerador`, `comercial`, `militar`, `urbano`) e múltiplas seeds (`42026`, `777`):
  - **Problema identificado 1:** Todas as 7 tecnologias eram concluídas até o turno 48, deixando o meio e fim de jogo sem progressão tecnológica.
    - **Ajuste (`lib/tech-engine.ts`):** Custos Tier 2 ajustados (`construction`: 18→30, `military`: 20→32, `trade`: 22→36) e Tier 3 (`metallurgy`: 28→54, `engineering`: 35→64), preservando Tier 1 (`agriculture`: 12, `mining`: 15).
  - **Problema identificado 2:** Estratégia `militar` entrava em déficit de ouro severo (`-170/turno`) por manutenção elevada de quartéis e torres.
    - **Ajuste (`lib/buildings-catalog.ts`):** Manutenção de `building-archery` (6→3), `unit-wall-tower` (5→3) e `building-tower` (3→2) suavizada.
- **Observação de Integração Futura:**
  - Os motores de exploração (`lib/exploration-engine.ts`) e vitória (`lib/victory-engine.ts`) integrados na `main` possuem hooks de áudio/efeitos prontos (`playDiscovery`, `playVictory`, `playDefeat`, `triggerEventEffect('discovery', ...)`), aguardando apenas a ligação de UI dedicada para exploração.
