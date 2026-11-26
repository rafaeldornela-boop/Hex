# Contrato — KayKit Visual Pilot

**Status:** piloto isolado (região axial ≤ 2 do centro)  
**Assets:** [KayKit Medieval Hexagon Pack 1.0](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0) (CC0)

## Objetivo

Validar migração visual parcial: terrenos, elevações, rios, estradas, construções e props do KayKit, **compondo** vários objetos por hex (não só trocar um GLB monólito).

## O que muda

| Item | Detalhe |
|------|---------|
| `lib/kaykit-pilot.ts` | Flag, raio, mapa asset→composição, lista de paths |
| CDN jsDelivr | GLTF do pack KayKit (sem binários no repo) |
| `HexSceneController` | Pré-load KayKit; tiles no raio piloto usam composição individual |

## O que NÃO muda

- Lógica de terreno, recursos, construções, economia, população, eventos, save/load, controles mobile
- `HEX_ASSETS` / índices de estrutura
- `main` e outros motores

## Como funciona

1. `isKaykitPilotTile(q, r)` — distância axial ≤ `KAYKIT_PILOT_RADIUS` (2).
2. Se o nome do asset tem composição em `COMPOSITIONS`, o hex sai do batch de terreno e vira mesh individual composta (`base` + `props`).
3. Fora do raio: pipeline legado (`/godot-assets/models/*.glb`).

## Escala / câmera

- `KAYKIT_MODEL_SCALE = 2.05` (igual a `HEX_WORLD_SCALE`) — calibrar após QA visual.
- Iluminação e câmera existentes; assets KayKit usam atlas de gradiente (estética low-poly).

## Expandir o piloto

1. Ampliar `COMPOSITIONS` em `kaykit-pilot.ts` (paths relativos ao CDN).
2. Aumentar `KAYKIT_PILOT_RADIUS` ou mapear o mapa inteiro quando validado.
3. Opcional: espelhar assets em `public/kaykit/` se quiser offline.

## Licença

CC0 — Kay Lousberg / KayKit. Uso comercial permitido; atribuição opcional.
