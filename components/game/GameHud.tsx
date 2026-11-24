'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coins,
  Crosshair,
  FolderOpen,
  Hammer,
  Pause,
  Play,
  RotateCw,
  Save,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { HexAssetEntry } from '@/lib/godot-docs';
import type { AxialCoord } from '@/lib/hex-engine';
import type { BuilderToolMode, GameModeState } from './HexSceneController';

export interface GameHudProps {
  gameState: GameModeState;
  cash: number;
  tileCount: number;
  selectedIndex: number;
  rotationDeg: number;
  toolMode: BuilderToolMode;
  hoveredCoord: AxialCoord | null;
  assets: HexAssetEntry[];
  muted: boolean;
  dockOpen: boolean;
  toastMessage: string | null;
  onStartGame: () => void;
  onResume: () => void;
  onPause: () => void;
  onBackToTitle: () => void;
  onResetStarter: () => void;
  onClearMap: () => void;
  onSelectPiece: (index: number) => void;
  onCyclePiece: (delta: number) => void;
  onRotatePiece: () => void;
  onSetToolMode: (mode: BuilderToolMode) => void;
  onSaveMap: () => void;
  onLoadMap: () => void;
  onToggleMute: () => void;
  onToggleDock: () => void;
  onCenterCamera: () => void;
  onZoom: (delta: number) => void;
}

const PALETTE_GROUPS = [
  { id: 'building', label: 'Prédios' },
  { id: 'terrain', label: 'Terrenos' },
  { id: 'path', label: 'Caminhos' },
  { id: 'river', label: 'Rios' },
  { id: 'unit', label: 'Unidades' },
  { id: 'all', label: 'Todos (72)' },
] as const;

type PaletteGroupId = (typeof PALETTE_GROUPS)[number]['id'];

const TERRAIN_CATEGORIES = new Set(['grass', 'stone', 'sand', 'water', 'dirt', 'bridge']);

function formatPieceLabel(name: string): string {
  return name
    .replace(/^building-/, '')
    .replace(/^unit-/, '')
    .replace(/-/g, ' ');
}

function formatCash(value: number): string {
  return `$${Math.round(value).toLocaleString('pt-BR')}`;
}

export default function GameHud({
  gameState,
  cash,
  tileCount,
  selectedIndex,
  rotationDeg,
  toolMode,
  hoveredCoord,
  assets,
  muted,
  dockOpen,
  toastMessage,
  onStartGame,
  onResume,
  onPause,
  onBackToTitle,
  onResetStarter,
  onClearMap,
  onSelectPiece,
  onCyclePiece,
  onRotatePiece,
  onSetToolMode,
  onSaveMap,
  onLoadMap,
  onToggleMute,
  onToggleDock,
  onCenterCamera,
  onZoom,
}: GameHudProps) {
  const [paletteGroup, setPaletteGroup] = useState<PaletteGroupId>('building');

  const activeAsset = assets[selectedIndex] ?? assets[0];

  const visiblePieces = useMemo(() => {
    return assets
      .map((asset, index) => ({ asset, index }))
      .filter(({ asset }) => {
        if (paletteGroup === 'all') return true;
        if (paletteGroup === 'terrain') return TERRAIN_CATEGORIES.has(asset.category);
        return asset.category === paletteGroup;
      });
  }, [assets, paletteGroup]);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* TITLE SCREEN OVERLAY */}
      {gameState === 'title' && (
        <div className="absolute inset-0 flex flex-col justify-between p-6 sm:p-10">
          {/* Top-right discreet link to Godot Guide */}
          <div className="flex justify-end">
            <Link
              href="/docs"
              className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#fcf9f2]/95 border-2 border-[#3c3426] text-[#2a2319] text-xs font-semibold shadow-[0_3px_0_#3c3426] hover:bg-white transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              Guia Godot &amp; ZIP
            </Link>
          </div>

          {/* Left-Third Calm Negative-Space Title Lockup */}
          <div className="max-w-md pointer-events-auto">
            <div className="bg-[#fcf9f2]/95 border-2 border-[#3c3426] rounded-2xl p-6 sm:p-7 shadow-[0_6px_0_#3c3426]">
              {/* Custom Inline SVG Crest + Title Lockup */}
              <div className="flex items-center gap-3.5">
                <svg
                  viewBox="0 0 56 56"
                  className="w-12 h-12 shrink-0"
                  aria-hidden="true"
                >
                  <polygon
                    points="28,3 50,15.5 50,40.5 28,53 6,40.5 6,15.5"
                    fill="#047857"
                    stroke="#2a2319"
                    strokeWidth="3"
                  />
                  <polygon
                    points="28,11 43,19.5 43,36.5 28,45 13,36.5 13,19.5"
                    fill="#34d399"
                    opacity="0.35"
                  />
                  <path
                    d="M28 15 L38 24 H34 V38 H22 V24 H18 Z"
                    fill="#fcf9f2"
                    stroke="#2a2319"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                  />
                  <rect x="25.5" y="29" width="5" height="9" fill="#d97706" />
                </svg>
                <div>
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1f1a12] leading-none">
                    Hexagon World
                  </h1>
                  <p className="mt-1.5 text-xs font-medium text-[#5c5140]">
                    Starter Kit 3D · 72 peças originais do Godot
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-start="true"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onStartGame();
                  }}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-700 text-white font-display text-sm font-bold border-2 border-[#1e2d24] shadow-[0_4px_0_#1e2d24] hover:bg-emerald-800 active:translate-y-0.5 transition-all whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  Jogar Agora
                </button>

                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white text-[#2a2319] font-display text-sm font-semibold border-2 border-[#3c3426] hover:bg-[#f5efe1] transition-colors whitespace-nowrap"
                >
                  Documentação Godot
                </Link>
              </div>
            </div>
          </div>

          {/* Flat Borderless Control Hint Line */}
          <div className="text-center">
            <p className="inline-block text-xs font-semibold text-[#1f2933] drop-shadow-[0_1px_0_rgba(255,255,255,0.85)]">
              WASD Mover Câmera · Clique Esquerdo Construir · Botão Direito / R Girar 60° · Q / E Trocar Peça · DEL Remover · F1 / F2 Salvar
            </p>
          </div>
        </div>
      )}

      {/* PLAYING HUD */}
      {gameState === 'playing' && (
        <>
          {/* Top-Left Compact Diorama Plaque */}
          <div className="absolute top-4 left-4 pointer-events-auto flex items-center gap-3 bg-[#fcf9f2]/95 border-2 border-[#3c3426] rounded-xl px-4 py-2.5 shadow-[0_3px_0_#3c3426]">
            <div className="flex items-center gap-2 pr-3 border-r border-[#d9ceb8]">
              <Coins className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                  Saldo
                </p>
                <p
                  data-testid="hud-cash"
                  className="font-display text-lg font-bold text-[#1f1a12] tabular-nums leading-tight"
                >
                  {formatCash(cash)}
                </p>
              </div>
            </div>

            <div className="pr-3 border-r border-[#d9ceb8]">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                Hexágonos
              </p>
              <p
                data-testid="hud-tiles"
                className="font-display text-lg font-bold text-[#1f1a12] tabular-nums leading-tight"
              >
                {tileCount}
              </p>
            </div>

            <div className="hidden sm:block">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                Cursor
              </p>
              <p className="font-mono text-xs font-semibold text-[#2a2319] tabular-nums leading-tight mt-0.5">
                {hoveredCoord ? `q:${hoveredCoord.q} r:${hoveredCoord.r}` : '—'}
              </p>
            </div>
          </div>

          {/* Ephemeral Toast Feedback */}
          {toastMessage && (
            <div
              role="status"
              aria-live="polite"
              className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1f2923] text-[#fcf9f2] border-2 border-[#3c3426] rounded-lg px-4 py-2 text-xs font-semibold shadow-md"
            >
              {toastMessage}
            </div>
          )}

          {/* Top-Right Compact Utility Controls */}
          <div className="absolute top-4 right-4 pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onSaveMap();
              }}
              aria-label="Salvar mapa (F1)"
              title="Salvar mapa (F1)"
              className="w-10 h-10 rounded-xl bg-[#fcf9f2]/95 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onLoadMap();
              }}
              aria-label="Carregar mapa (F2)"
              title="Carregar mapa (F2)"
              className="w-10 h-10 rounded-xl bg-[#fcf9f2]/95 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={muted ? 'Ativar som (M)' : 'Silenciar som (M)'}
              title={muted ? 'Ativar som (M)' : 'Silenciar som (M)'}
              className="w-10 h-10 rounded-xl bg-[#fcf9f2]/95 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
            >
              {muted ? (
                <VolumeX className="w-4 h-4 text-rose-700" aria-hidden="true" />
              ) : (
                <Volume2 className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <Link
              href="/docs"
              aria-label="Abrir guia do projeto Godot"
              title="Guia Godot & ZIP"
              className="w-10 h-10 rounded-xl bg-[#fcf9f2]/95 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center"
            >
              <BookOpen className="w-4 h-4 text-emerald-700" aria-hidden="true" />
            </Link>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              aria-label="Pausar jogo (Esc ou P)"
              title="Pausar (Esc / P)"
              className="w-10 h-10 rounded-xl bg-[#fcf9f2]/95 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
            >
              <Pause className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Unified Collapsible Bottom Builder Dock */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(920px,95vw)] flex flex-col items-center pointer-events-none">
            {/* Collapse / Expand Toggle Handle */}
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleDock();
              }}
              className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-t-lg bg-[#fcf9f2]/95 border-2 border-b-0 border-[#3c3426] text-[11px] font-semibold text-[#3c3426] hover:bg-white cursor-pointer"
            >
              {dockOpen ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  Ocultar Peças [H]
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  Mostrar Peças [H]
                </>
              )}
            </button>

            <div className="pointer-events-auto w-full bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-2xl shadow-[0_4px_0_#3c3426] p-2.5 space-y-2">
              {/* Compact Action & Active Piece Bar (Always reachable) */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onCyclePiece(-1);
                    }}
                    aria-label="Peça anterior (Q)"
                    title="Peça anterior (Q)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <div className="px-2.5 py-1 rounded-lg bg-white border border-[#d9ceb8] min-w-[175px] max-w-[260px]">
                    <p
                      data-testid="hud-active-piece"
                      className="text-xs font-bold text-[#1f1a12] truncate capitalize"
                    >
                      #{selectedIndex + 1} {formatPieceLabel(activeAsset.name)}
                    </p>
                    <p
                      data-testid="hud-orientation"
                      className="font-mono text-[10px] text-[#6e604a] tabular-nums"
                    >
                      {rotationDeg}° · ${activeAsset.price} · {activeAsset.category}
                    </p>
                  </div>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onCyclePiece(1);
                    }}
                    aria-label="Próxima peça (E)"
                    title="Próxima peça (E)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Tool & Camera Quick Controls */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onRotatePiece();
                    }}
                    title="Girar peça em 60° (Botão direito ou R)"
                    className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-white border border-[#bcae96] text-xs font-semibold text-[#2a2319] hover:bg-[#f2ebdc] whitespace-nowrap cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                    Girar [R]
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onSetToolMode(toolMode === 'build' ? 'demolish' : 'build');
                    }}
                    title="Alternar modo Construir / Demolir (ou tecla DEL)"
                    className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      toolMode === 'demolish'
                        ? 'bg-rose-700 border-rose-900 text-white'
                        : 'bg-emerald-700 border-emerald-900 text-white'
                    }`}
                  >
                    {toolMode === 'demolish' ? (
                      <>
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Demolir
                      </>
                    ) : (
                      <>
                        <Hammer className="w-3.5 h-3.5" aria-hidden="true" />
                        Construir
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onCenterCamera();
                    }}
                    aria-label="Centralizar câmera (F)"
                    title="Centralizar câmera (F)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onZoom(-1.6);
                    }}
                    aria-label="Aproximar câmera (+)"
                    title="Aproximar (+)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onZoom(1.6);
                    }}
                    aria-label="Afastar câmera (-)"
                    title="Afastar (-)"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Expandable 72-Piece Selector Drawer */}
              {dockOpen && (
                <div className="pt-2 border-t border-[#e0d6c3] space-y-2">
                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
                    {PALETTE_GROUPS.map((grp) => {
                      const active = paletteGroup === grp.id;
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.currentTarget.blur();
                            setPaletteGroup(grp.id);
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? 'bg-[#2a2319] text-[#fcf9f2]'
                              : 'bg-[#efe8d8] text-[#4c4232] hover:bg-[#e5dcc7]'
                          }`}
                        >
                          {grp.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {visiblePieces.map(({ asset, index }) => {
                      const isSelected = index === selectedIndex && toolMode === 'build';
                      return (
                        <button
                          key={asset.file}
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.currentTarget.blur();
                            onSetToolMode('build');
                            onSelectPiece(index);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-700 border-emerald-900 text-white'
                              : 'bg-white border-[#d9ceb8] text-[#2a2319] hover:bg-[#f5efe1]'
                          }`}
                        >
                          <span className="block text-[11px] font-semibold capitalize leading-tight">
                            {formatPieceLabel(asset.name)}
                          </span>
                          <span
                            className={`block font-mono text-[10px] tabular-nums ${
                              isSelected ? 'text-emerald-100' : 'text-[#6e604a]'
                            }`}
                          >
                            #{index + 1} {asset.price > 0 ? `· $${asset.price}` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* PAUSE MODAL */}
      {gameState === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-title"
          className="fixed inset-0 bg-[#1a221d]/55 flex items-center justify-center p-4 pointer-events-auto"
        >
          <div className="w-full max-w-md bg-[#fcf9f2] border-2 border-[#3c3426] rounded-2xl p-6 shadow-[0_8px_0_#3c3426] space-y-5">
            <div>
              <h2 id="pause-title" className="font-display text-2xl font-bold text-[#1f1a12]">
                Jogo Pausado
              </h2>
              <p className="mt-1 text-xs text-[#5c5140]">
                Seu progresso pode ser salvo localmente com F1 e restaurado com F2.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Saldo</p>
                <p className="mt-1 font-display text-base font-bold text-[#1f1a12] tabular-nums">
                  {formatCash(cash)}
                </p>
              </div>
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Hexágonos</p>
                <p className="mt-1 font-display text-base font-bold text-[#1f1a12] tabular-nums">
                  {tileCount}
                </p>
              </div>
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Rotação</p>
                <p className="mt-1 font-display text-base font-bold text-[#1f1a12] tabular-nums">
                  {rotationDeg}°
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onResume();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 text-white font-display text-sm font-bold border-2 border-[#1e2d24] shadow-[0_3px_0_#1e2d24] hover:bg-emerald-800 cursor-pointer"
              >
                Continuar Jogando
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onResetStarter();
                  }}
                  className="py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-semibold text-[#2a2319] hover:bg-[#f5efe1] cursor-pointer"
                >
                  Reiniciar Ilha
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onClearMap();
                  }}
                  className="py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-semibold text-[#2a2319] hover:bg-[#f5efe1] cursor-pointer"
                >
                  Mapa Limpo
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Link
                  href="/docs"
                  className="py-2 px-3 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-xs font-semibold text-[#2a2319] hover:bg-[#e5dcc7] text-center"
                >
                  Guia Godot &amp; ZIP
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onBackToTitle();
                  }}
                  className="py-2 px-3 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-xs font-semibold text-[#2a2319] hover:bg-[#e5dcc7] cursor-pointer"
                >
                  Tela Inicial
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
