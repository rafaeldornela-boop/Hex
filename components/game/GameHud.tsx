'use client';

import { memo, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coins,
  Compass,
  Crosshair,
  FolderOpen,
  Hammer,
  Layers,
  Menu,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Save,
  Trash2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { HexAssetEntry } from '@/lib/godot-docs';
import type { AxialCoord } from '@/lib/hex-engine';
import { formatHexDisplayName } from '@/lib/world-domain';
import type { BuilderToolMode, GameModeState } from './HexSceneController';

export interface GameHudProps {
  gameState: GameModeState;
  cash: number;
  tileCount: number;
  selectedIndex: number;
  rotationDeg: number;
  toolMode: BuilderToolMode;
  hoveredCoord: AxialCoord | null;
  selectedHex: AxialCoord | null;
  selectedTileAssetName: string | null;
  assets: HexAssetEntry[];
  muted: boolean;
  dockOpen: boolean;
  buildSheetOpen: boolean;
  cameraStripOpen: boolean;
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
  onConfirmSelectedHex: () => void;
  onDemolishSelectedHex: () => void;
  onCancelAction: () => void;
  onSaveMap: () => void;
  onLoadMap: () => void;
  onToggleMute: () => void;
  onToggleDock: () => void;
  onSetBuildSheetOpen: (open: boolean) => void;
  onToggleCameraStrip: () => void;
  onCenterCamera: () => void;
  onZoom: (delta: number) => void;
  onRotateCamera: (radians: number) => void;
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

function formatCash(value: number): string {
  return `$${Math.round(value).toLocaleString('pt-BR')}`;
}

const GameHud = memo(function GameHud({
  gameState,
  cash,
  tileCount,
  selectedIndex,
  rotationDeg,
  toolMode,
  hoveredCoord,
  selectedHex,
  selectedTileAssetName,
  assets,
  muted,
  dockOpen,
  buildSheetOpen,
  cameraStripOpen,
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
  onConfirmSelectedHex,
  onDemolishSelectedHex,
  onCancelAction,
  onSaveMap,
  onLoadMap,
  onToggleMute,
  onToggleDock,
  onSetBuildSheetOpen,
  onToggleCameraStrip,
  onCenterCamera,
  onZoom,
  onRotateCamera,
}: GameHudProps) {
  const [paletteGroup, setPaletteGroup] = useState<PaletteGroupId>('building');

  const activeAsset = assets[selectedIndex] ?? assets[0];
  const activePieceLabel = formatHexDisplayName(activeAsset.name);
  const hasCancellableState =
    selectedHex !== null || toolMode === 'demolish' || buildSheetOpen;

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
      {/* TITLE SCREEN OVERLAY (Safe-area aware, portrait & desktop tuned) */}
      {gameState === 'title' && (
        <div
          className="absolute inset-0 flex flex-col justify-between"
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          {/* Top-right discreet link to Godot Guide */}
          <div className="flex justify-end">
            <Link
              href="/docs"
              className="pointer-events-auto inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] text-xs font-semibold shadow-[0_3px_0_#3c3426] hover:bg-white transition-colors whitespace-nowrap"
            >
              <BookOpen className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
              Guia Godot &amp; ZIP
            </Link>
          </div>

          {/* Mobile: bottom-anchored lockup leaving upper island clear | Desktop: left-third calm negative space */}
          <div className="mt-auto md:my-auto w-full max-w-md pointer-events-auto">
            <div className="bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-2xl p-5 sm:p-7 shadow-[0_6px_0_#3c3426]">
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
                <div className="min-w-0">
                  <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#1f1a12] leading-none">
                    Hexagon World
                  </h1>
                  <p className="mt-1.5 text-xs font-medium text-[#5c5140]">
                    Construtor 3D · 72 peças originais
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5">
                <button
                  type="button"
                  data-start="true"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onStartGame();
                  }}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 text-white font-display text-sm font-bold border-2 border-[#1e2d24] shadow-[0_4px_0_#1e2d24] hover:bg-emerald-800 active:translate-y-0.5 transition-all whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  Jogar Agora
                </button>

                <Link
                  href="/docs"
                  className="inline-flex items-center justify-center gap-2 min-h-[46px] px-4 py-2.5 rounded-xl bg-white text-[#2a2319] font-display text-sm font-semibold border-2 border-[#3c3426] hover:bg-[#f5efe1] transition-colors whitespace-nowrap"
                >
                  Documentação Godot
                </Link>
              </div>
            </div>
          </div>

          {/* Control Hint Line (tailored per form factor) */}
          <div className="pt-3 text-center">
            <p className="md:hidden inline-block text-[11px] font-semibold text-[#1f2933] drop-shadow-[0_1px_0_rgba(255,255,255,0.9)]">
              Arraste para mover · Pinça para zoom e girar · Toque para construir
            </p>
            <p className="hidden md:inline-block text-xs font-semibold text-[#1f2933] drop-shadow-[0_1px_0_rgba(255,255,255,0.85)]">
              WASD Mover Câmera · Clique Esquerdo Construir · Botão Direito / R Girar 60° · Q / E Trocar Peça · DEL Remover · F1 / F2 Salvar
            </p>
          </div>
        </div>
      )}

      {/* PLAYING HUD */}
      {gameState === 'playing' && (
        <>
          {/* TOP BAR (Safe-area aware, shared responsive cash plaque + adaptive right controls) */}
          <div
            className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2 pointer-events-none"
            style={{
              paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
              paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
              paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
            }}
          >
            {/* Top-Left Compact Cash & Tiles Plaque (Single DOM source for mobile & desktop) */}
            <div className="pointer-events-auto flex items-center gap-2.5 sm:gap-3 bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 shadow-[0_3px_0_#3c3426]">
              <div className="flex items-center gap-1.5 sm:gap-2 pr-2.5 sm:pr-3 border-r border-[#d9ceb8]">
                <Coins className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                    Saldo
                  </p>
                  <p
                    data-testid="hud-cash"
                    className="font-display text-base sm:text-lg font-bold text-[#1f1a12] tabular-nums leading-tight"
                  >
                    {formatCash(cash)}
                  </p>
                </div>
              </div>

              <div className="md:pr-3 md:border-r md:border-[#d9ceb8]">
                <p className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                  Hexágonos
                </p>
                <p
                  data-testid="hud-tiles"
                  className="font-display text-base sm:text-lg font-bold text-[#1f1a12] tabular-nums leading-tight"
                >
                  {tileCount}
                </p>
              </div>

              {/* Desktop-only live hover coordinate */}
              <div className="hidden md:block">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6e604a] leading-none">
                  Cursor
                </p>
                <p className="font-mono text-xs font-semibold text-[#2a2319] tabular-nums leading-tight mt-0.5">
                  {hoveredCoord ? `q:${hoveredCoord.q} r:${hoveredCoord.r}` : '—'}
                </p>
              </div>
            </div>

            {/* Mobile Top-Right: Minimal 2-button cluster (Camera + Menu) >= 44x44px */}
            <div className="md:hidden pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                data-testid="mobile-camera-toggle"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleCameraStrip();
                }}
                aria-label="Controles de câmera"
                aria-expanded={cameraStripOpen}
                className={`w-11 h-11 rounded-xl border-2 border-[#3c3426] shadow-[0_3px_0_#3c3426] flex items-center justify-center cursor-pointer transition-colors ${
                  cameraStripOpen
                    ? 'bg-emerald-700 text-white'
                    : 'bg-[#fcf9f2]/96 text-[#2a2319] active:bg-white'
                }`}
              >
                <Compass className="w-5 h-5" aria-hidden="true" />
              </button>

              <button
                type="button"
                data-testid="mobile-menu-button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onPause();
                }}
                aria-label="Abrir menu e opções"
                className="w-11 h-11 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] active:bg-white flex items-center justify-center cursor-pointer"
              >
                <Menu className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Desktop Top-Right: Preserved 5-button utility strip */}
            <div className="hidden md:flex pointer-events-auto items-center gap-1.5">
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onSaveMap();
                }}
                aria-label="Salvar mapa (F1)"
                title="Salvar mapa (F1)"
                className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
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
                className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
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
                className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
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
                className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center"
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
                className="w-10 h-10 rounded-xl bg-[#fcf9f2]/96 border-2 border-[#3c3426] text-[#2a2319] shadow-[0_3px_0_#3c3426] hover:bg-white flex items-center justify-center cursor-pointer"
              >
                <Pause className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Mobile Optional Compact Camera Controls Strip (pops neatly under top-right button) */}
          {cameraStripOpen && (
            <div
              className="md:hidden absolute right-3 z-20 pointer-events-auto flex items-center gap-1.5 bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-xl p-1.5 shadow-[0_4px_0_#3c3426]"
              style={{
                top: 'calc(max(0.75rem, env(safe-area-inset-top)) + 3.5rem)',
                right: 'max(0.75rem, env(safe-area-inset-right))',
              }}
            >
              <button
                type="button"
                onClick={() => onRotateCamera(-Math.PI / 4)}
                aria-label="Girar câmera para esquerda"
                className="w-11 h-11 rounded-lg bg-white border border-[#c7b99e] text-[#2a2319] active:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onRotateCamera(Math.PI / 4)}
                aria-label="Girar câmera para direita"
                className="w-11 h-11 rounded-lg bg-white border border-[#c7b99e] text-[#2a2319] active:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
              >
                <RotateCw className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onCenterCamera}
                aria-label="Centralizar câmera"
                className="w-11 h-11 rounded-lg bg-white border border-[#c7b99e] text-[#2a2319] active:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
              >
                <Crosshair className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onZoom(-1.8)}
                aria-label="Aproximar câmera"
                className="w-11 h-11 rounded-lg bg-white border border-[#c7b99e] text-[#2a2319] active:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onZoom(1.8)}
                aria-label="Afastar câmera"
                className="w-11 h-11 rounded-lg bg-white border border-[#c7b99e] text-[#2a2319] active:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
              >
                <ZoomOut className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Ephemeral Toast Feedback */}
          {toastMessage && (
            <div
              role="status"
              aria-live="polite"
              style={{
                top: 'calc(max(0.75rem, env(safe-area-inset-top)) + 3.75rem)',
              }}
              className="absolute left-1/2 -translate-x-1/2 z-30 bg-[#1f2923] text-[#fcf9f2] border-2 border-[#3c3426] rounded-xl px-4 py-2 text-xs font-semibold shadow-md whitespace-nowrap max-w-[92vw] truncate"
            >
              {toastMessage}
            </div>
          )}

          {/* ========================================================= */}
          {/* MOBILE PLAYING HUD (< md): MAPA GRANDE + POUCOS CONTROLES */}
          {/* ========================================================= */}
          <div
            className="md:hidden fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 pointer-events-none"
            style={{
              paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
              paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
              paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
            }}
          >
            {/* Contextual Selected-Hex Bar (only visible after tapping a hex) */}
            {selectedHex && !buildSheetOpen && (
              <div
                data-testid="mobile-selection-bar"
                className="pointer-events-auto w-full max-w-md bg-[#fcf9f2]/98 border-2 border-[#3c3426] rounded-2xl p-2.5 shadow-[0_4px_0_#3c3426] space-y-2"
              >
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[#1f1a12] truncate capitalize">
                      {selectedTileAssetName
                        ? formatHexDisplayName(selectedTileAssetName)
                        : 'Hexágono vazio'}
                    </p>
                    <p className="font-mono text-[10px] text-[#6e604a] tabular-nums">
                      q:{selectedHex.q} r:{selectedHex.r} · peça:{' '}
                      <span className="capitalize font-sans font-semibold text-[#2a2319]">
                        {activePieceLabel}
                      </span>
                      {activeAsset.price > 0 ? ` ($${activeAsset.price})` : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={onCancelAction}
                    aria-label="Cancelar seleção"
                    className="w-10 h-10 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="mobile-confirm-build"
                    onClick={onConfirmSelectedHex}
                    className="flex-1 min-h-[44px] px-3 rounded-xl bg-emerald-700 text-white font-display text-xs font-bold border-2 border-[#1e2d24] shadow-[0_2px_0_#1e2d24] active:translate-y-0.5 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {selectedTileAssetName ? 'Substituir' : 'Construir'}
                    {activeAsset.price > 0 ? ` ($${activeAsset.price})` : ''}
                  </button>

                  <button
                    type="button"
                    onClick={onRotatePiece}
                    aria-label="Girar peça selecionada"
                    className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-white border-2 border-[#3c3426] text-[#2a2319] text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <RotateCw className="w-4 h-4" aria-hidden="true" />
                    <span className="font-mono text-[11px]">{rotationDeg}°</span>
                  </button>

                  {selectedTileAssetName && (
                    <button
                      type="button"
                      data-testid="mobile-demolish-selected"
                      onClick={onDemolishSelectedHex}
                      aria-label="Demolir hexágono selecionado"
                      className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-rose-700 text-white border-2 border-rose-950 flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Demolish Active Indicator Banner (when demolish mode is toggled on mobile) */}
            {toolMode === 'demolish' && !buildSheetOpen && (
              <div className="pointer-events-auto flex items-center gap-2 bg-rose-700 text-white border-2 border-rose-950 rounded-xl px-3.5 py-1.5 text-xs font-semibold shadow-sm">
                <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Toque em um hexágono para demolir</span>
              </div>
            )}

            {/* Primary Mobile Thumb Dock (4 spacious >= 52px touch buttons) */}
            {!buildSheetOpen && (
              <div className="pointer-events-auto w-full max-w-md bg-[#fcf9f2]/96 border-2 border-[#3c3426] rounded-2xl p-1.5 shadow-[0_4px_0_#3c3426] flex items-stretch gap-1.5">
                {/* 1. Prominent Build / Pieces Drawer Button */}
                <button
                  type="button"
                  data-testid="mobile-build-button"
                  onClick={() => {
                    if (toolMode === 'demolish') {
                      onSetToolMode('build');
                    }
                    onSetBuildSheetOpen(true);
                  }}
                  className={`flex-1 min-w-0 min-h-[52px] px-3 rounded-xl border-2 flex items-center gap-2.5 text-left cursor-pointer transition-colors ${
                    toolMode === 'build'
                      ? 'bg-emerald-700 border-[#1e2d24] text-white shadow-[0_2px_0_#1e2d24]'
                      : 'bg-white border-[#c8ba9f] text-[#2a2319]'
                  }`}
                >
                  <Layers className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="block text-[10px] font-bold uppercase tracking-wider opacity-85 leading-none">
                      Construir
                    </span>
                    <span className="block text-xs font-bold capitalize truncate leading-tight mt-0.5">
                      {activePieceLabel}
                      {activeAsset.price > 0 ? ` · $${activeAsset.price}` : ''}
                    </span>
                  </div>
                </button>

                {/* 2. Rotate 60° */}
                <button
                  type="button"
                  data-testid="mobile-rotate-button"
                  onClick={onRotatePiece}
                  aria-label="Girar peça 60 graus"
                  className="min-w-[60px] min-h-[52px] px-2 rounded-xl bg-white border-2 border-[#3c3426] text-[#2a2319] active:bg-[#f2ebdc] flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                >
                  <RotateCw className="w-4 h-4" aria-hidden="true" />
                  <span className="font-mono text-[10px] font-bold leading-none">
                    {rotationDeg}°
                  </span>
                </button>

                {/* 3. Demolish Toggle */}
                <button
                  type="button"
                  data-testid="mobile-demolish-button"
                  onClick={() =>
                    onSetToolMode(toolMode === 'demolish' ? 'build' : 'demolish')
                  }
                  aria-label="Alternar modo demolir"
                  aria-pressed={toolMode === 'demolish'}
                  className={`min-w-[60px] min-h-[52px] px-2 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                    toolMode === 'demolish'
                      ? 'bg-rose-700 border-rose-950 text-white'
                      : 'bg-white border-[#3c3426] text-[#2a2319] active:bg-[#f2ebdc]'
                  }`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  <span className="text-[10px] font-bold leading-none">Demolir</span>
                </button>

                {/* 4. Contextual Cancel OR Quick Save */}
                {hasCancellableState ? (
                  <button
                    type="button"
                    data-testid="mobile-cancel-button"
                    onClick={onCancelAction}
                    aria-label="Cancelar ação atual"
                    className="min-w-[60px] min-h-[52px] px-2 rounded-xl bg-[#efe8d8] border-2 border-[#3c3426] text-[#1f1a12] active:bg-[#e5dcc7] flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                    <span className="text-[10px] font-bold leading-none">Cancelar</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="mobile-save-button"
                    onClick={onSaveMap}
                    aria-label="Salvar mapa"
                    className="min-w-[60px] min-h-[52px] px-2 rounded-xl bg-white border-2 border-[#3c3426] text-[#2a2319] active:bg-[#f2ebdc] flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <Save className="w-4 h-4" aria-hidden="true" />
                    <span className="text-[10px] font-bold leading-none">Salvar</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Mobile Build Bottom Sheet (<= 48dvh so map stays clearly visible above) */}
          {buildSheetOpen && (
            <div className="md:hidden fixed inset-0 z-30 flex flex-col justify-end pointer-events-auto">
              {/* Tap backdrop above sheet to dismiss immediately */}
              <button
                type="button"
                aria-label="Fechar catálogo de peças"
                onClick={() => onSetBuildSheetOpen(false)}
                className="flex-1 w-full bg-[#1a221d]/25 cursor-default"
              />

              <div
                data-testid="mobile-build-sheet"
                className="w-full max-h-[50dvh] flex flex-col bg-[#fcf9f2] border-t-2 border-x-2 border-[#3c3426] rounded-t-3xl shadow-[0_-8px_24px_rgba(31,26,18,0.2)]"
                style={{
                  paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
                  paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
                  paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
                }}
              >
                {/* Sheet Drag Indicator & Header */}
                <div className="pt-2.5 pb-2 px-1 flex items-center justify-between gap-2 border-b border-[#e0d6c3]">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-bold text-[#1f1a12]">
                      Escolher Peça ({visiblePieces.length})
                    </p>
                    <p className="text-[11px] text-[#5c5140] truncate">
                      Ativa: <span className="capitalize font-semibold">{activePieceLabel}</span>
                      {activeAsset.price > 0 ? ` · $${activeAsset.price}` : ''}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSetBuildSheetOpen(false)}
                    aria-label="Fechar painel de construção"
                    className="w-11 h-11 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>

                {/* Touch-Friendly Category Tabs */}
                <div className="py-2 flex items-center gap-1.5 overflow-x-auto hex-touch-scroll-x shrink-0">
                  {PALETTE_GROUPS.map((grp) => {
                    const active = paletteGroup === grp.id;
                    return (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => setPaletteGroup(grp.id)}
                        className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active
                            ? 'bg-[#2a2319] text-[#fcf9f2]'
                            : 'bg-[#efe8d8] text-[#4c4232] active:bg-[#e5dcc7]'
                        }`}
                      >
                        {grp.label}
                      </button>
                    );
                  })}
                </div>

                {/* Scrollable Touch Piece Grid */}
                <div className="flex-1 min-h-0 overflow-y-auto hex-touch-scroll pb-1">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {visiblePieces.map(({ asset, index }) => {
                      const isSelected = index === selectedIndex && toolMode === 'build';
                      return (
                        <button
                          key={asset.file}
                          type="button"
                          onClick={() => {
                            onSetToolMode('build');
                            onSelectPiece(index);
                            onSetBuildSheetOpen(false);
                          }}
                          className={`min-h-[56px] px-3 py-2 rounded-xl border-2 text-left transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-700 border-[#1e2d24] text-white'
                              : 'bg-white border-[#d9ceb8] text-[#2a2319] active:bg-[#f5efe1]'
                          }`}
                        >
                          <span className="block text-xs font-bold capitalize leading-tight truncate">
                            {formatHexDisplayName(asset.name)}
                          </span>
                          <span
                            className={`mt-1 block font-mono text-[11px] tabular-nums ${
                              isSelected ? 'text-emerald-100' : 'text-[#6e604a]'
                            }`}
                          >
                            #{index + 1} {asset.price > 0 ? `· $${asset.price}` : '· Grátis'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* DESKTOP PLAYING HUD (md+): PRESERVED CLASSIC WORKFLOW     */}
          {/* ========================================================= */}
          <div className="hidden md:flex absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(940px,95vw)] flex-col items-center pointer-events-none">
            {/* Collapse / Expand Toggle Handle */}
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleDock();
              }}
              className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-t-lg bg-[#fcf9f2]/96 border-2 border-b-0 border-[#3c3426] text-[11px] font-semibold text-[#3c3426] hover:bg-white cursor-pointer"
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
              {/* Compact Action & Active Piece Bar */}
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
                      #{selectedIndex + 1} {activePieceLabel}
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
                      onRotateCamera(-Math.PI / 4);
                    }}
                    aria-label="Girar câmera esquerda"
                    title="Girar câmera -45°"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onRotateCamera(Math.PI / 4);
                    }}
                    aria-label="Girar câmera direita"
                    title="Girar câmera +45°"
                    className="w-8 h-8 rounded-lg bg-white border border-[#bcae96] text-[#2a2319] hover:bg-[#f2ebdc] flex items-center justify-center cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
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
                            {formatHexDisplayName(asset.name)}
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

      {/* PAUSE / SECONDARY MENU SHEET (Touch-optimized for mobile & crisp modal on desktop) */}
      {gameState === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-title"
          className="fixed inset-0 z-40 bg-[#1a221d]/55 flex items-end sm:items-center justify-center sm:p-4 pointer-events-auto"
        >
          <div
            className="w-full max-w-md max-h-[88dvh] overflow-y-auto hex-touch-scroll bg-[#fcf9f2] border-t-2 sm:border-2 border-[#3c3426] rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-[0_8px_0_#3c3426] space-y-4"
            style={{
              paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="pause-title" className="font-display text-2xl font-bold text-[#1f1a12]">
                  Menu &amp; Pausa
                </h2>
                <p className="mt-1 text-xs text-[#5c5140]">
                  Salve seu mapa localmente ou ajuste som e ilha inicial.
                </p>
              </div>

              <button
                type="button"
                onClick={onResume}
                aria-label="Fechar menu"
                className="w-11 h-11 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-[#2a2319] flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Saldo</p>
                <p className="mt-0.5 font-display text-sm sm:text-base font-bold text-[#1f1a12] tabular-nums truncate">
                  {formatCash(cash)}
                </p>
              </div>
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Hexágonos</p>
                <p className="mt-0.5 font-display text-sm sm:text-base font-bold text-[#1f1a12] tabular-nums">
                  {tileCount}
                </p>
              </div>
              <div className="bg-white border border-[#d9ceb8] rounded-xl p-2.5">
                <p className="text-[10px] font-bold uppercase text-[#6e604a]">Rotação</p>
                <p className="mt-0.5 font-display text-sm sm:text-base font-bold text-[#1f1a12] tabular-nums">
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
                className="w-full min-h-[48px] py-2.5 px-4 rounded-xl bg-emerald-700 text-white font-display text-sm font-bold border-2 border-[#1e2d24] shadow-[0_3px_0_#1e2d24] hover:bg-emerald-800 cursor-pointer"
              >
                Continuar Jogando
              </button>

              {/* Save / Load directly reachable by touch */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSaveMap();
                    onResume();
                  }}
                  className="min-h-[46px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-bold text-[#2a2319] hover:bg-[#f5efe1] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  Salvar Mapa
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onLoadMap();
                    onResume();
                  }}
                  className="min-h-[46px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-bold text-[#2a2319] hover:bg-[#f5efe1] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-amber-700" aria-hidden="true" />
                  Carregar Mapa
                </button>
              </div>

              {/* Sound toggle directly reachable by touch */}
              <button
                type="button"
                onClick={onToggleMute}
                className="w-full min-h-[46px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-bold text-[#2a2319] hover:bg-[#f5efe1] inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {muted ? (
                  <>
                    <VolumeX className="w-4 h-4 text-rose-700" aria-hidden="true" />
                    Som: Silenciado (toque para ativar)
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                    Som: Ligado (toque para silenciar)
                  </>
                )}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onResetStarter();
                  }}
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-semibold text-[#2a2319] hover:bg-[#f5efe1] cursor-pointer"
                >
                  Reiniciar Ilha
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onClearMap();
                  }}
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-white border-2 border-[#3c3426] text-xs font-semibold text-[#2a2319] hover:bg-[#f5efe1] cursor-pointer"
                >
                  Mapa Limpo
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Link
                  href="/docs"
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-xs font-semibold text-[#2a2319] hover:bg-[#e5dcc7] inline-flex items-center justify-center"
                >
                  Guia Godot &amp; ZIP
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onBackToTitle();
                  }}
                  className="min-h-[44px] py-2 px-3 rounded-xl bg-[#efe8d8] border border-[#c8ba9f] text-xs font-semibold text-[#2a2319] hover:bg-[#e5dcc7] cursor-pointer"
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
});

export default GameHud;
