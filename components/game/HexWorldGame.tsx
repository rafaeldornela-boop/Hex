'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  conquerHexInState,
  countPlayerTerritory,
  evaluateConquest,
  getConquestFailureMessage,
} from '@/lib/territory-engine';
import {
  INCOMPATIBLE_TERRAIN_MESSAGE,
  calculatePlayerResources,
  canBuildStructureOnTerrain,
  describeTerrain,
  getHexTerrainAndResource,
} from '@/lib/terrain-engine';
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
  const [toolMode, setToolMode] = useState<BuilderToolMode>('expand');
  const [hoveredCoord, setHoveredCoord] = useState<AxialCoord | null>(null);
  const [selectedHex, setSelectedHex] = useState<AxialCoord | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [dockOpen, setDockOpen] = useState<boolean>(true);
  const [buildSheetOpen, setBuildSheetOpen] = useState<boolean>(false);
  const [cameraStripOpen, setCameraStripOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Refs synced for stable controller callbacks (never tear down WebGL canvas on HUD state change)
  const gameStateRef = useRef(gameState);
  const worldStateRef = useRef(worldState);
  const selectedIndexRef = useRef(selectedIndex);
  const rotationDegRef = useRef(rotationDeg);
  const toolModeRef = useRef(toolMode);
  const selectedHexRef = useRef(selectedHex);
  const buildSheetOpenRef = useRef(buildSheetOpen);

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
  useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);
  useEffect(() => {
    selectedHexRef.current = selectedHex;
  }, [selectedHex]);
  useEffect(() => {
    buildSheetOpenRef.current = buildSheetOpen;
  }, [buildSheetOpen]);

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

  const setSelectedHexSynced = useCallback((coord: AxialCoord | null) => {
    selectedHexRef.current = coord;
    setSelectedHex(coord);
    controllerRef.current?.setSelectedHex(coord);
  }, []);

  const handlePlaceAt = useCallback(
    (q: number, r: number) => {
      const { nextState, changed, blockedReason } = placeHexInState(
        worldStateRef.current,
        q,
        r,
        selectedIndexRef.current,
        rotationDegRef.current,
        HEX_ASSETS
      );
      if (blockedReason === 'incompatible_terrain') {
        gameAudio.playError();
        showToast(INCOMPATIBLE_TERRAIN_MESSAGE);
        return;
      }
      if (!changed) return;
      worldStateRef.current = nextState;
      setWorldState(nextState);
      gameAudio.playPlace();
      controllerRef.current?.syncWorldState(nextState, [hexKey(q, r)]);
    },
    [showToast]
  );

  const handleDemolishAt = useCallback((q: number, r: number) => {
    const { nextState, removed } = demolishHexInState(worldStateRef.current, q, r);
    if (!removed) return;
    worldStateRef.current = nextState;
    setWorldState(nextState);
    gameAudio.playDemolish();
    controllerRef.current?.syncWorldState(nextState, [hexKey(q, r)]);
  }, []);

  const handleConquerAt = useCallback(
    (q: number, r: number) => {
      const result = conquerHexInState(worldStateRef.current, q, r, HEX_ASSETS);
      if (!result.conquered) {
        gameAudio.playError();
        if (result.reason) {
          showToast(getConquestFailureMessage(result.reason, result.cost));
        }
        return;
      }

      worldStateRef.current = result.nextState;
      setWorldState(result.nextState);
      setSelectedHexSynced(null);
      gameAudio.playConquest();
      controllerRef.current?.syncWorldState(
        result.nextState,
        undefined,
        [hexKey(q, r)]
      );
    },
    [setSelectedHexSynced, showToast]
  );

  /**
   * Selection handler shared by desktop clicks in Expand mode and touch taps.
   */
  const handleSelectHexAt = useCallback(
    (q: number, r: number) => {
      setSelectedHexSynced({ q, r });
      gameAudio.playCycle();
    },
    [setSelectedHexSynced]
  );

  /**
   * Touch-first tap workflow:
   * - If the mobile build sheet is open, tapping the map dismisses it cleanly.
   * - In Expand mode: tapping any hex selects it and shows conquest status + "Conquistar" button.
   * - In Demolish mode: tapping an occupied hex demolishes it; tapping empty clears selection.
   * - In Build mode: first tap selects/previews the hex; tapping the same hex again builds immediately.
   */
  const handleTouchTapAt = useCallback(
    (q: number, r: number) => {
      if (buildSheetOpenRef.current) {
        buildSheetOpenRef.current = false;
        setBuildSheetOpen(false);
        return;
      }

      if (toolModeRef.current === 'expand') {
        handleSelectHexAt(q, r);
        return;
      }

      if (toolModeRef.current === 'demolish') {
        const existing = worldStateRef.current.hexes[hexKey(q, r)];
        if (existing) {
          handleDemolishAt(q, r);
        }
        setSelectedHexSynced(null);
        return;
      }

      const prev = selectedHexRef.current;
      if (prev && prev.q === q && prev.r === r) {
        handlePlaceAt(q, r);
        return;
      }

      setSelectedHexSynced({ q, r });
      gameAudio.playCycle();
    },
    [handleDemolishAt, handlePlaceAt, handleSelectHexAt, setSelectedHexSynced]
  );

  const handleConfirmSelectedHex = useCallback(() => {
    const coord = selectedHexRef.current;
    if (!coord) return;
    if (toolModeRef.current === 'expand') {
      handleConquerAt(coord.q, coord.r);
    } else if (toolModeRef.current === 'demolish') {
      handleDemolishAt(coord.q, coord.r);
      setSelectedHexSynced(null);
    } else {
      handlePlaceAt(coord.q, coord.r);
    }
  }, [handleConquerAt, handleDemolishAt, handlePlaceAt, setSelectedHexSynced]);

  const handleDemolishSelectedHex = useCallback(() => {
    const coord = selectedHexRef.current;
    if (!coord) return;
    handleDemolishAt(coord.q, coord.r);
  }, [handleDemolishAt]);

  const handleCancelAction = useCallback(() => {
    let didCancel = false;
    if (buildSheetOpenRef.current) {
      buildSheetOpenRef.current = false;
      setBuildSheetOpen(false);
      didCancel = true;
    }
    if (selectedHexRef.current) {
      setSelectedHexSynced(null);
      didCancel = true;
    }
    if (toolModeRef.current === 'demolish') {
      toolModeRef.current = 'expand';
      setToolMode('expand');
      controllerRef.current?.setToolMode('expand');
      didCancel = true;
    }
    if (didCancel) {
      gameAudio.playCycle();
    }
  }, [setSelectedHexSynced]);

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
    toolModeRef.current = 'build';
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
    toolModeRef.current = mode;
    setToolMode(mode);
    controllerRef.current?.setToolMode(mode);
  }, []);

  const handleSaveMap = useCallback(() => {
    try {
      const serialized = serializeWorldState(worldStateRef.current);
      window.localStorage.setItem(STORAGE_KEY, serialized);
      gameAudio.playSaveChime();
      showToast('Mapa salvo localmente');
    } catch {
      showToast('Não foi possível salvar no navegador');
    }
  }, [showToast]);

  const handleLoadMap = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        showToast('Nenhum mapa salvo ainda');
        return;
      }
      const loaded = deserializeWorldState(raw, HEX_ASSETS.length);
      if (!loaded) {
        showToast('Arquivo salvo inválido');
        return;
      }
      worldStateRef.current = loaded;
      setWorldState(loaded);
      setSelectedHexSynced(null);
      controllerRef.current?.syncWorldState(loaded);
      gameAudio.playSaveChime();
      showToast(`Mapa carregado (${Object.keys(loaded.hexes).length} peças)`);
    } catch {
      showToast('Erro ao carregar mapa');
    }
  }, [setSelectedHexSynced, showToast]);

  const handleStartGame = useCallback(() => {
    document.body.dataset.state = 'playing';
    setGameState('playing');
  }, []);

  const handleResume = useCallback(() => {
    setGameState('playing');
  }, []);

  const handlePause = useCallback(() => {
    buildSheetOpenRef.current = false;
    setBuildSheetOpen(false);
    setCameraStripOpen(false);
    setGameState('paused');
  }, []);

  const handleBackToTitle = useCallback(() => {
    buildSheetOpenRef.current = false;
    setBuildSheetOpen(false);
    setCameraStripOpen(false);
    setSelectedHexSynced(null);
    setGameState('title');
  }, [setSelectedHexSynced]);

  const handleResetStarter = useCallback(() => {
    const starter = createStarterWorldState(HEX_ASSETS);
    worldStateRef.current = starter;
    setWorldState(starter);
    setSelectedHexSynced(null);
    controllerRef.current?.syncWorldState(starter);
    controllerRef.current?.centerCamera();
    setGameState('playing');
    showToast('Ilha inicial restaurada');
  }, [setSelectedHexSynced, showToast]);

  const handleClearMap = useCallback(() => {
    const empty = createEmptyWorldState();
    worldStateRef.current = empty;
    setWorldState(empty);
    setSelectedHexSynced(null);
    controllerRef.current?.syncWorldState(empty);
    controllerRef.current?.centerCamera();
    setGameState('playing');
    showToast('Mapa limpo — pronto para construir do zero');
  }, [setSelectedHexSynced, showToast]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      gameAudio.setMuted(next);
      return next;
    });
  }, []);

  const handleToggleDock = useCallback(() => {
    setDockOpen((prev) => !prev);
  }, []);

  const handleSetBuildSheetOpen = useCallback((open: boolean) => {
    buildSheetOpenRef.current = open;
    setBuildSheetOpen(open);
    if (open) {
      setCameraStripOpen(false);
    }
  }, []);

  const handleToggleCameraStrip = useCallback(() => {
    setCameraStripOpen((prev) => {
      const next = !prev;
      if (next) {
        buildSheetOpenRef.current = false;
        setBuildSheetOpen(false);
      }
      return next;
    });
  }, []);

  const handleCenterCamera = useCallback(() => {
    controllerRef.current?.centerCamera();
  }, []);

  const handleZoom = useCallback((delta: number) => {
    controllerRef.current?.zoomBy(delta);
  }, []);

  const handleRotateCamera = useCallback((radians: number) => {
    controllerRef.current?.rotateCameraBy(radians);
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
      onTouchTapAt: handleTouchTapAt,
      onSelectHexAt: handleSelectHexAt,
      onRotate: handleRotatePiece,
      onCycleStructure: handleCyclePiece,
      onLoadProgress: () => {},
    });

    controllerRef.current = controller;
    controller.setGameState(gameStateRef.current);
    controller.setToolMode(toolModeRef.current);
    controller.setSelectedPiece(selectedIndexRef.current, rotationDegRef.current);
    controller.syncWorldState(worldStateRef.current);

    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      controller.dispose();
      controllerRef.current = null;
    };
  }, [
    handlePlaceAt,
    handleDemolishAt,
    handleTouchTapAt,
    handleSelectHexAt,
    handleRotatePiece,
    handleCyclePiece,
  ]);

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

      if (e.code === 'Escape') {
        e.preventDefault();
        if (buildSheetOpenRef.current || selectedHexRef.current) {
          handleCancelAction();
          return;
        }
        setGameState((curr) => (curr === 'playing' ? 'paused' : 'playing'));
        return;
      }

      if (e.code === 'KeyP') {
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
        const target =
          selectedHexRef.current ?? controllerRef.current?.getHoveredCoord();
        if (target) {
          handleDemolishAt(target.q, target.r);
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
    handleCancelAction,
    handleCyclePiece,
    handleRotatePiece,
    handleDemolishAt,
    handleSaveMap,
    handleLoadMap,
    handleToggleMute,
  ]);

  const tileCount = useMemo(
    () => Object.keys(worldState.hexes).length,
    [worldState.hexes]
  );

  const territoryCount = useMemo(
    () => countPlayerTerritory(worldState),
    [worldState]
  );

  const playerResources = useMemo(
    () => calculatePlayerResources(worldState),
    [worldState]
  );

  const selectedTileAssetName = useMemo(() => {
    if (!selectedHex) return null;
    const existing = worldState.hexes[hexKey(selectedHex.q, selectedHex.r)];
    if (!existing) return null;
    return HEX_ASSETS[existing.structureIndex]?.name ?? null;
  }, [selectedHex, worldState.hexes]);

  const selectedConquest = useMemo(() => {
    if (!selectedHex) return null;
    return evaluateConquest(worldState, selectedHex.q, selectedHex.r, HEX_ASSETS);
  }, [selectedHex, worldState]);

  const selectedTerrainInfo = useMemo(() => {
    if (!selectedHex) return null;
    const existing = worldState.hexes[hexKey(selectedHex.q, selectedHex.r)];
    const info = getHexTerrainAndResource(selectedHex.q, selectedHex.r, existing);
    return describeTerrain(info.terrainType);
  }, [selectedHex, worldState.hexes]);

  const hoveredTerrainInfo = useMemo(() => {
    if (!hoveredCoord) return null;
    const existing = worldState.hexes[hexKey(hoveredCoord.q, hoveredCoord.r)];
    const info = getHexTerrainAndResource(hoveredCoord.q, hoveredCoord.r, existing);
    return describeTerrain(info.terrainType);
  }, [hoveredCoord, worldState.hexes]);

  const canBuildActiveOnSelected = useMemo(() => {
    if (!selectedTerrainInfo) return true;
    const asset = HEX_ASSETS[selectedIndex];
    if (!asset) return true;
    return canBuildStructureOnTerrain(asset, selectedTerrainInfo.type);
  }, [selectedIndex, selectedTerrainInfo]);

  return (
    <div className="fixed inset-0 h-[100dvh] w-screen overflow-hidden bg-[#9bd2ee] hex-game-viewport">
      {/* Isolated WebGL canvas mount container (never re-rendered by HUD updates) */}
      <div
        ref={canvasMountRef}
        data-testid="hex-webgl-canvas"
        className="w-full h-full touch-none"
      />

      {/* Sibling DOM HUD overlay (memoized to prevent unnecessary re-renders) */}
      <GameHud
        gameState={gameState}
        cash={worldState.cash}
        territoryCount={territoryCount}
        playerResources={playerResources}
        tileCount={tileCount}
        selectedIndex={selectedIndex}
        rotationDeg={rotationDeg}
        toolMode={toolMode}
        hoveredCoord={hoveredCoord}
        hoveredTerrainInfo={hoveredTerrainInfo}
        selectedHex={selectedHex}
        selectedTileAssetName={selectedTileAssetName}
        selectedConquest={selectedConquest}
        selectedTerrainInfo={selectedTerrainInfo}
        canBuildActiveOnSelected={canBuildActiveOnSelected}
        assets={HEX_ASSETS}
        muted={muted}
        dockOpen={dockOpen}
        buildSheetOpen={buildSheetOpen}
        cameraStripOpen={cameraStripOpen}
        toastMessage={toastMessage}
        onStartGame={handleStartGame}
        onResume={handleResume}
        onPause={handlePause}
        onBackToTitle={handleBackToTitle}
        onResetStarter={handleResetStarter}
        onClearMap={handleClearMap}
        onSelectPiece={handleSelectPiece}
        onCyclePiece={handleCyclePiece}
        onRotatePiece={handleRotatePiece}
        onSetToolMode={handleSetToolMode}
        onConfirmSelectedHex={handleConfirmSelectedHex}
        onDemolishSelectedHex={handleDemolishSelectedHex}
        onCancelAction={handleCancelAction}
        onSaveMap={handleSaveMap}
        onLoadMap={handleLoadMap}
        onToggleMute={handleToggleMute}
        onToggleDock={handleToggleDock}
        onSetBuildSheetOpen={handleSetBuildSheetOpen}
        onToggleCameraStrip={handleToggleCameraStrip}
        onCenterCamera={handleCenterCamera}
        onZoom={handleZoom}
        onRotateCamera={handleRotateCamera}
      />
    </div>
  );
}
