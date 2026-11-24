'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_ROTATION_DEG,
  createEmptyWorldState,
  createStarterWorldState,
  cycleStructureIndex,
  demolishHexInState,
  deserializeWorldState,
  hexKey,
  placeHexInState,
  rotateHexStep,
  serializeWorldState,
  type AxialCoord,
  type HexWorldState,
} from '@/lib/hex-engine';
import { HEX_ASSETS } from '@/lib/repo-data';
import { gameAudio } from '@/lib/game-audio';
import {
  HexSceneController,
  type BuilderToolMode,
  type GameModeState,
} from './HexSceneController';
import GameHud from './GameHud';

const STORAGE_KEY = 'hexagon_world_saved_map_v1';

const DEFAULT_HOUSE_INDEX = Math.max(
  0,
  HEX_ASSETS.findIndex((a) => a.name === 'building-house')
);

interface HexWorldGameProps {
  initialAutostart?: boolean;
}

export default function HexWorldGame({ initialAutostart = false }: HexWorldGameProps) {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<HexSceneController | null>(null);

  const [gameState, setGameState] = useState<GameModeState>(
    initialAutostart ? 'playing' : 'title'
  );
  const [worldState, setWorldState] = useState<HexWorldState>(() =>
    createStarterWorldState(HEX_ASSETS)
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(DEFAULT_HOUSE_INDEX);
  const [rotationDeg, setRotationDeg] = useState<number>(DEFAULT_ROTATION_DEG);
  const [toolMode, setToolMode] = useState<BuilderToolMode>('build');
  const [hoveredCoord, setHoveredCoord] = useState<AxialCoord | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [dockOpen, setDockOpen] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Refs synced for stable controller callbacks (never tear down WebGL canvas on HUD state change)
  const gameStateRef = useRef(gameState);
  const worldStateRef = useRef(worldState);
  const selectedIndexRef = useRef(selectedIndex);
  const rotationDegRef = useRef(rotationDeg);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    worldStateRef.current = worldState;
  }, [worldState]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);
  useEffect(() => {
    rotationDegRef.current = rotationDeg;
  }, [rotationDeg]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  // Mirror state machine to document.body.dataset.state
  useEffect(() => {
    document.body.dataset.state = gameState;
    controllerRef.current?.setGameState(gameState);
  }, [gameState]);

  const handlePlaceAt = useCallback((q: number, r: number) => {
    const { nextState, changed } = placeHexInState(
      worldStateRef.current,
      q,
      r,
      selectedIndexRef.current,
      rotationDegRef.current,
      HEX_ASSETS
    );
    if (!changed) return;
    worldStateRef.current = nextState;
    setWorldState(nextState);
    gameAudio.playPlace();
    controllerRef.current?.syncWorldState(nextState, [hexKey(q, r)]);
  }, []);

  const handleDemolishAt = useCallback((q: number, r: number) => {
    const { nextState, removed } = demolishHexInState(worldStateRef.current, q, r);
    if (!removed) return;
    worldStateRef.current = nextState;
    setWorldState(nextState);
    gameAudio.playDemolish();
    controllerRef.current?.syncWorldState(nextState, [hexKey(q, r)]);
  }, []);

  const handleRotatePiece = useCallback(() => {
    setRotationDeg((prev) => {
      const next = rotateHexStep(prev, 1);
      rotationDegRef.current = next;
      controllerRef.current?.setSelectedPiece(selectedIndexRef.current, next);
      return next;
    });
    gameAudio.playRotate();
  }, []);

  const handleCyclePiece = useCallback((delta: number) => {
    setToolMode('build');
    controllerRef.current?.setToolMode('build');
    setSelectedIndex((prev) => {
      const next = cycleStructureIndex(prev, delta, HEX_ASSETS.length);
      selectedIndexRef.current = next;
      controllerRef.current?.setSelectedPiece(next, rotationDegRef.current);
      return next;
    });
    gameAudio.playCycle();
  }, []);

  const handleSelectPiece = useCallback((index: number) => {
    setSelectedIndex(index);
    selectedIndexRef.current = index;
    controllerRef.current?.setSelectedPiece(index, rotationDegRef.current);
    gameAudio.playCycle();
  }, []);

  const handleSetToolMode = useCallback((mode: BuilderToolMode) => {
    setToolMode(mode);
    controllerRef.current?.setToolMode(mode);
  }, []);

  const handleSaveMap = useCallback(() => {
    try {
      const serialized = serializeWorldState(worldStateRef.current);
      window.localStorage.setItem(STORAGE_KEY, serialized);
      gameAudio.playSaveChime();
      showToast('Mapa salvo localmente (F1)');
    } catch {
      showToast('Não foi possível salvar no navegador');
    }
  }, [showToast]);

  const handleLoadMap = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        showToast('Nenhum mapa salvo ainda (use F1)');
        return;
      }
      const loaded = deserializeWorldState(raw, HEX_ASSETS.length);
      if (!loaded) {
        showToast('Arquivo salvo inválido');
        return;
      }
      worldStateRef.current = loaded;
      setWorldState(loaded);
      controllerRef.current?.syncWorldState(loaded);
      gameAudio.playSaveChime();
      showToast(`Mapa carregado (${Object.keys(loaded.hexes).length} peças)`);
    } catch {
      showToast('Erro ao carregar mapa');
    }
  }, [showToast]);

  const handleStartGame = useCallback(() => {
    document.body.dataset.state = 'playing';
    setGameState('playing');
  }, []);

  const handleResetStarter = useCallback(() => {
    const starter = createStarterWorldState(HEX_ASSETS);
    worldStateRef.current = starter;
    setWorldState(starter);
    controllerRef.current?.syncWorldState(starter);
    controllerRef.current?.centerCamera();
    setGameState('playing');
    showToast('Ilha inicial restaurada');
  }, [showToast]);

  const handleClearMap = useCallback(() => {
    const empty = createEmptyWorldState();
    worldStateRef.current = empty;
    setWorldState(empty);
    controllerRef.current?.syncWorldState(empty);
    controllerRef.current?.centerCamera();
    setGameState('playing');
    showToast('Mapa limpo — pronto para construir do zero');
  }, [showToast]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      gameAudio.setMuted(next);
      return next;
    });
  }, []);

  // Mount Three.js controller ONCE inside isolated mount container
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const controller = new HexSceneController(mountEl, {
      onHoverChange: (coord) => {
        setHoveredCoord(coord);
      },
      onPlaceAt: handlePlaceAt,
      onDemolishAt: handleDemolishAt,
      onRotate: handleRotatePiece,
      onCycleStructure: handleCyclePiece,
      onLoadProgress: () => {},
    });

    controllerRef.current = controller;
    controller.setGameState(gameStateRef.current);
    controller.setSelectedPiece(selectedIndexRef.current, rotationDegRef.current);
    controller.syncWorldState(worldStateRef.current);

    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      controller.dispose();
      controllerRef.current = null;
    };
  }, [handlePlaceAt, handleDemolishAt, handleRotatePiece, handleCyclePiece]);

  // Unified keyboard bindings for Title Start, Gameplay actions, and Pause
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const state = gameStateRef.current;

      if (state === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartGame();
        }
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        setGameState((curr) => (curr === 'playing' ? 'paused' : 'playing'));
        return;
      }

      if (state !== 'playing') return;

      if (e.code === 'KeyQ') {
        e.preventDefault();
        handleCyclePiece(-1);
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        handleCyclePiece(1);
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        handleRotatePiece();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        const hovered = controllerRef.current?.getHoveredCoord();
        if (hovered) {
          handleDemolishAt(hovered.q, hovered.r);
        }
      } else if (e.code === 'F1') {
        e.preventDefault();
        handleSaveMap();
      } else if (e.code === 'F2') {
        e.preventDefault();
        handleLoadMap();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        handleToggleMute();
      } else if (e.code === 'KeyH') {
        e.preventDefault();
        setDockOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleStartGame,
    handleCyclePiece,
    handleRotatePiece,
    handleDemolishAt,
    handleSaveMap,
    handleLoadMap,
    handleToggleMute,
  ]);

  const tileCount = Object.keys(worldState.hexes).length;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#cde6f5]">
      {/* Isolated WebGL canvas mount container (never re-rendered by HUD updates) */}
      <div
        ref={canvasMountRef}
        data-testid="hex-webgl-canvas"
        className="w-full h-full"
      />

      {/* Sibling DOM HUD overlay */}
      <GameHud
        gameState={gameState}
        cash={worldState.cash}
        tileCount={tileCount}
        selectedIndex={selectedIndex}
        rotationDeg={rotationDeg}
        toolMode={toolMode}
        hoveredCoord={hoveredCoord}
        assets={HEX_ASSETS}
        muted={muted}
        dockOpen={dockOpen}
        toastMessage={toastMessage}
        onStartGame={handleStartGame}
        onResume={() => setGameState('playing')}
        onPause={() => setGameState('paused')}
        onBackToTitle={() => setGameState('title')}
        onResetStarter={handleResetStarter}
        onClearMap={handleClearMap}
        onSelectPiece={handleSelectPiece}
        onCyclePiece={handleCyclePiece}
        onRotatePiece={handleRotatePiece}
        onSetToolMode={handleSetToolMode}
        onSaveMap={handleSaveMap}
        onLoadMap={handleLoadMap}
        onToggleMute={handleToggleMute}
        onToggleDock={() => setDockOpen((prev) => !prev)}
        onCenterCamera={() => controllerRef.current?.centerCamera()}
        onZoom={(delta) => controllerRef.current?.zoomBy(delta)}
      />
    </div>
  );
}
