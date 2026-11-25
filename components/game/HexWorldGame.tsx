'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ROTATION_DEG,
  hasHexConstruction,
  hexKey,
  rotateHexStep,
  type AxialCoord,
} from '@/lib/hex-engine';
import { HEX_ASSETS } from '@/lib/repo-data';
import {
  AXIAL_DIRECTIONS,
  countPlayerTerritory,
  getExpandableFrontierCoords,
  getHexOwner,
  getInfluenceCoverageCoords,
} from '@/lib/territory-engine';
import {
  describeTerrain,
  getHexTerrainAndResource,
  getStrategicRegionInfo,
} from '@/lib/terrain-engine';
import { computeEffectiveBuildCost } from '@/lib/economy-engine';
import { STRATEGY_PALETTE_ORDER } from '@/lib/buildings-catalog';
import {
  evaluateHexBuildOptions,
  validateBuildCandidateOnHex,
  type HexBuildEvaluation,
} from '@/lib/build-rules';
import { createRandomWorldSeed } from '@/lib/world-generator';
import {
  UNIT_CATALOG,
  getUnitAt,
  type UnitEntity,
  type UnitType,
} from '@/lib/military-engine';
import type { TechId } from '@/lib/tech-engine';
import type { TradableResource } from '@/lib/trade-engine';
import {
  canBuildOrUpgradeRoad,
  getRoadAt,
  type RoadLevelDefinition,
  type RoadTile,
} from '@/lib/road-engine';
import { getCityAtCoord, type CityEntity } from '@/lib/city-engine';
import { computeCalendarSnapshot } from '@/lib/calendar-engine';
import { getDayPhaseForTurn } from '@/lib/day-night-engine';
import { createInitialClimateWeather } from '@/lib/season-engine';
import {
  getBuildingLevel,
  type BuildingUpgradeEvaluation,
} from '@/lib/building-upgrade-engine';
import {
  advanceKingdomTurn,
  buildInKingdom,
  buildOrUpgradeRoadInKingdom,
  commandUnitInKingdom,
  createSandboxKingdomState,
  createStarterKingdomState,
  demolishInKingdom,
  deserializeKingdomState,
  evaluateBuildingUpgradeInKingdom,
  evaluateExpansionInKingdom,
  getConstructionAt,
  getExpansionAt,
  getKingdomEconomy,
  getKingdomMarket,
  getKingdomProgression,
  getKingdomRoadSummary,
  getKingdomTerritoryCapacity,
  getUnderConstructionKeys,
  getUpgradingConstructionsByKey,
  performDiplomacyAction,
  recruitUnitInKingdom,
  resolveKingdomEvent,
  serializeKingdomState,
  setActiveResearchInKingdom,
  startExpansionInKingdom,
  tradeResourceInKingdom,
  upgradeBuildingInKingdom,
  type KingdomState,
} from '@/lib/kingdom-engine';
import { gameAudio } from '@/lib/game-audio';
import {
  HexSceneController,
  type BuilderToolMode,
  type GameModeState,
} from './HexSceneController';
import GameHud from './GameHud';
import KingdomModal, { type KingdomModalTab } from './KingdomModal';

const STORAGE_KEY = 'hexagon_world_saved_map_v1';

const DEFAULT_HOUSE_INDEX = Math.max(
  0,
  HEX_ASSETS.findIndex((a) => a.name === 'building-house')
);

const CONSTRUCTIBLE_INDEXES: number[] = STRATEGY_PALETTE_ORDER.map((name) =>
  HEX_ASSETS.findIndex((a) => a.name === name)
).filter((idx) => idx >= 0);

interface HexWorldGameProps {
  initialAutostart?: boolean;
}

function computeValidUnitTargets(
  state: KingdomState,
  source: AxialCoord
): AxialCoord[] {
  const unit = getUnitAt(state.units, source.q, source.r);
  if (!unit || unit.owner !== 'player' || unit.movedThisTurn) return [];

  const uDef = UNIT_CATALOG[unit.type];
  const targets: AxialCoord[] = [];

  for (const dir of AXIAL_DIRECTIONS) {
    const tq = source.q + dir.q;
    const tr = source.r + dir.r;
    const tile = state.worldState.hexes[hexKey(tq, tr)];
    if (typeof state.worldState.worldCols === 'number' && !tile) continue;
    const terrainInfo = getHexTerrainAndResource(tq, tr, tile);

    if (uDef.navalOnly && terrainInfo.terrainType !== 'water') continue;
    if (!uDef.navalOnly && terrainInfo.terrainType === 'water') {
      const isBridge =
        tile &&
        HEX_ASSETS[tile.structureIndex]?.name === 'bridge' &&
        !getConstructionAt(state, tq, tr);
      if (!isBridge) continue;
    }

    const occupant = getUnitAt(state.units, tq, tr);
    const targetOwner = tile?.owner ?? 'neutral';
    if ((targetOwner === 'player' || targetOwner === 'neutral') && occupant) {
      continue;
    }

    targets.push({ q: tq, r: tr });
  }

  return targets;
}

function getUpgradingKeysSet(state: KingdomState): Set<string> {
  return new Set(Object.keys(getUpgradingConstructionsByKey(state)));
}

export default function HexWorldGame({ initialAutostart = false }: HexWorldGameProps) {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<HexSceneController | null>(null);

  const [gameState, setGameState] = useState<GameModeState>(
    initialAutostart ? 'playing' : 'title'
  );
  const [kingdomState, setKingdomState] = useState<KingdomState>(() =>
    createStarterKingdomState(HEX_ASSETS)
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(DEFAULT_HOUSE_INDEX);
  const [rotationDeg, setRotationDeg] = useState<number>(DEFAULT_ROTATION_DEG);
  const [toolMode, setToolMode] = useState<BuilderToolMode>('expand');
  const [selectedHex, setSelectedHex] = useState<AxialCoord | null>(null);
  const [commandSource, setCommandSource] = useState<AxialCoord | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [autoTurnEnabled, setAutoTurnEnabled] = useState<boolean>(false);
  const [dockOpen, setDockOpen] = useState<boolean>(true);
  const [buildSheetOpen, setBuildSheetOpen] = useState<boolean>(false);
  const [kingdomModalOpen, setKingdomModalOpen] = useState<boolean>(false);
  const [kingdomModalTab, setKingdomModalTab] = useState<KingdomModalTab>('economy');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Refs synced for stable controller callbacks
  const gameStateRef = useRef(gameState);
  const kingdomStateRef = useRef(kingdomState);
  const selectedIndexRef = useRef(selectedIndex);
  const rotationDegRef = useRef(rotationDeg);
  const toolModeRef = useRef(toolMode);
  const selectedHexRef = useRef(selectedHex);
  const commandSourceRef = useRef(commandSource);
  const buildSheetOpenRef = useRef(buildSheetOpen);
  const kingdomModalOpenRef = useRef(kingdomModalOpen);
  const contextualBuildRef = useRef<HexBuildEvaluation | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    kingdomStateRef.current = kingdomState;
  }, [kingdomState]);
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
    commandSourceRef.current = commandSource;
  }, [commandSource]);
  useEffect(() => {
    buildSheetOpenRef.current = buildSheetOpen;
  }, [buildSheetOpen]);
  useEffect(() => {
    kingdomModalOpenRef.current = kingdomModalOpen;
  }, [kingdomModalOpen]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    document.body.dataset.state = gameState;
    controllerRef.current?.setGameState(gameState);
  }, [gameState]);

  const syncSceneUnits = useCallback(
    (nextKingdom: KingdomState, activeCommandSource: AxialCoord | null) => {
      const validTargets = activeCommandSource
        ? computeValidUnitTargets(nextKingdom, activeCommandSource)
        : [];
      controllerRef.current?.syncUnits(
        nextKingdom.units,
        activeCommandSource,
        validTargets
      );
    },
    []
  );

  const syncSceneRoadsAndCities = useCallback(
    (nextKingdom: KingdomState, underKeys?: Set<string>) => {
      const under = underKeys ?? getUnderConstructionKeys(nextKingdom);
      const connectivity = getKingdomRoadSummary(nextKingdom, HEX_ASSETS);
      controllerRef.current?.syncRoadsAndCities({
        roads: nextKingdom.roads ?? {},
        cities: nextKingdom.cities ?? [],
        connectivity,
        worldState: nextKingdom.worldState,
        underConstructionKeys: under,
      });
    },
    []
  );

  const syncSceneAtmosphere = useCallback(
    (nextKingdom: KingdomState, snap = false) => {
      const cal = nextKingdom.calendar ?? computeCalendarSnapshot(nextKingdom.turn);
      const phase = nextKingdom.dayPhase ?? getDayPhaseForTurn(nextKingdom.turn);
      const weather = (nextKingdom.climateWeather ?? createInitialClimateWeather()).id;
      controllerRef.current?.setAtmosphereState({
        phase,
        season: cal.season,
        seasonProgress: cal.seasonProgress,
        weather,
        worldSeed: nextKingdom.worldSeed ?? nextKingdom.worldState.seed,
        snap,
      });
    },
    []
  );

  const setSelectedHexSynced = useCallback((coord: AxialCoord | null) => {
    selectedHexRef.current = coord;
    setSelectedHex(coord);
    controllerRef.current?.setSelectedHex(coord);
  }, []);

  const clearCommandMode = useCallback(
    (nextKingdom?: KingdomState) => {
      commandSourceRef.current = null;
      setCommandSource(null);
      toolModeRef.current = 'expand';
      setToolMode('expand');
      controllerRef.current?.setToolMode('expand');
      syncSceneUnits(nextKingdom ?? kingdomStateRef.current, null);
    },
    [syncSceneUnits]
  );

  const handlePlaceAt = useCallback(
    (q: number, r: number) => {
      const res = buildInKingdom(
        kingdomStateRef.current,
        q,
        r,
        selectedIndexRef.current,
        rotationDegRef.current,
        HEX_ASSETS
      );
      if (!res.built) {
        gameAudio.playError();
        if (res.messagePt) showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playPlace();
      const under = getUnderConstructionKeys(res.nextState);
      const upgrading = getUpgradingKeysSet(res.nextState);
      controllerRef.current?.syncWorldState(
        res.nextState.worldState,
        [hexKey(q, r)],
        undefined,
        under,
        undefined,
        upgrading
      );
      syncSceneRoadsAndCities(res.nextState, under);
      if (res.messagePt) showToast(res.messagePt);
    },
    [showToast, syncSceneRoadsAndCities]
  );

  const handleRoadAt = useCallback(
    (q: number, r: number) => {
      const res = buildOrUpgradeRoadInKingdom(
        kingdomStateRef.current,
        q,
        r,
        HEX_ASSETS
      );
      if (!res.built) {
        gameAudio.playError();
        if (res.messagePt) showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playPlace();
      syncSceneRoadsAndCities(res.nextState);
      if (res.messagePt) showToast(res.messagePt);
    },
    [showToast, syncSceneRoadsAndCities]
  );

  const handleBuildRoadSelected = useCallback(() => {
    const coord = selectedHexRef.current;
    if (!coord) return;
    handleRoadAt(coord.q, coord.r);
  }, [handleRoadAt]);

  const handleDemolishAt = useCallback(
    (q: number, r: number) => {
      const res = demolishInKingdom(kingdomStateRef.current, q, r, HEX_ASSETS);
      if (!res.removed) {
        gameAudio.playError();
        if (res.messagePt) showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playDemolish();
      const under = getUnderConstructionKeys(res.nextState);
      const upgrading = getUpgradingKeysSet(res.nextState);
      controllerRef.current?.syncWorldState(
        res.nextState.worldState,
        [hexKey(q, r)],
        undefined,
        under,
        undefined,
        upgrading
      );
      syncSceneRoadsAndCities(res.nextState, under);
      if (res.messagePt) showToast(res.messagePt);
    },
    [showToast, syncSceneRoadsAndCities]
  );

  const handleStartExpansionAt = useCallback(
    (q: number, r: number) => {
      const res = startExpansionInKingdom(
        kingdomStateRef.current,
        q,
        r,
        HEX_ASSETS
      );
      if (!res.started) {
        gameAudio.playError();
        showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playConquest();
      showToast(res.messagePt);
    },
    [showToast]
  );

  const handleSelectHexAt = useCallback(
    (q: number, r: number) => {
      const cmdSrc = commandSourceRef.current;
      if (toolModeRef.current === 'command' && cmdSrc) {
        if (cmdSrc.q === q && cmdSrc.r === r) {
          clearCommandMode();
          setSelectedHexSynced({ q, r });
          return;
        }
        const cmdRes = commandUnitInKingdom(
          kingdomStateRef.current,
          cmdSrc,
          { q, r },
          HEX_ASSETS
        );
        if (!cmdRes.acted) {
          gameAudio.playError();
          showToast(cmdRes.messagePt);
          return;
        }
        kingdomStateRef.current = cmdRes.nextState;
        setKingdomState(cmdRes.nextState);
        clearCommandMode(cmdRes.nextState);
        setSelectedHexSynced({ q, r });
        if (cmdRes.capturedKey) {
          gameAudio.playConquest();
          const under = getUnderConstructionKeys(cmdRes.nextState);
          const upgrading = getUpgradingKeysSet(cmdRes.nextState);
          controllerRef.current?.syncWorldState(
            cmdRes.nextState.worldState,
            undefined,
            [cmdRes.capturedKey],
            under,
            undefined,
            upgrading
          );
          syncSceneRoadsAndCities(cmdRes.nextState, under);
        } else {
          gameAudio.playCycle();
        }
        showToast(cmdRes.messagePt);
        return;
      }

      setSelectedHexSynced({ q, r });
      gameAudio.playCycle();
    },
    [clearCommandMode, setSelectedHexSynced, showToast, syncSceneRoadsAndCities]
  );

  const handleTouchTapAt = useCallback(
    (q: number, r: number) => {
      if (buildSheetOpenRef.current) {
        buildSheetOpenRef.current = false;
        setBuildSheetOpen(false);
        return;
      }

      if (toolModeRef.current === 'command' || toolModeRef.current === 'expand') {
        handleSelectHexAt(q, r);
        return;
      }

      if (toolModeRef.current === 'demolish') {
        const existing = kingdomStateRef.current.worldState.hexes[hexKey(q, r)];
        if (existing) {
          handleDemolishAt(q, r);
        }
        setSelectedHexSynced(null);
        return;
      }

      if (toolModeRef.current === 'road') {
        const prev = selectedHexRef.current;
        if (prev && prev.q === q && prev.r === r) {
          handleRoadAt(q, r);
          return;
        }
        setSelectedHexSynced({ q, r });
        gameAudio.playCycle();
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
    [handleDemolishAt, handlePlaceAt, handleRoadAt, handleSelectHexAt, setSelectedHexSynced]
  );

  const handleConfirmSelectedHex = useCallback(() => {
    const coord = selectedHexRef.current;
    if (!coord) return;
    if (toolModeRef.current === 'expand') {
      handleStartExpansionAt(coord.q, coord.r);
    } else if (toolModeRef.current === 'road') {
      handleRoadAt(coord.q, coord.r);
    } else if (toolModeRef.current === 'demolish') {
      handleDemolishAt(coord.q, coord.r);
      setSelectedHexSynced(null);
    } else if (toolModeRef.current === 'build') {
      handlePlaceAt(coord.q, coord.r);
    }
  }, [handleStartExpansionAt, handleRoadAt, handleDemolishAt, handlePlaceAt, setSelectedHexSynced]);

  const handleDemolishSelectedHex = useCallback(() => {
    const coord = selectedHexRef.current;
    if (!coord) return;
    handleDemolishAt(coord.q, coord.r);
  }, [handleDemolishAt]);

  const handleUpgradeSelectedHex = useCallback(() => {
    const coord = selectedHexRef.current;
    if (!coord) return;
    const res = upgradeBuildingInKingdom(
      kingdomStateRef.current,
      coord.q,
      coord.r,
      HEX_ASSETS
    );
    if (!res.started) {
      gameAudio.playError();
      showToast(res.messagePt);
      return;
    }
    kingdomStateRef.current = res.nextState;
    setKingdomState(res.nextState);
    gameAudio.playPlace();
    const under = getUnderConstructionKeys(res.nextState);
    const upgrading = getUpgradingKeysSet(res.nextState);
    controllerRef.current?.syncWorldState(
      res.nextState.worldState,
      [hexKey(coord.q, coord.r)],
      undefined,
      under,
      undefined,
      upgrading
    );
    syncSceneRoadsAndCities(res.nextState, under);
    showToast(res.messagePt);
  }, [showToast, syncSceneRoadsAndCities]);

  const handleCancelAction = useCallback(() => {
    let didCancel = false;
    if (buildSheetOpenRef.current) {
      buildSheetOpenRef.current = false;
      setBuildSheetOpen(false);
      didCancel = true;
    }
    if (commandSourceRef.current) {
      clearCommandMode();
      didCancel = true;
    }
    if (selectedHexRef.current) {
      setSelectedHexSynced(null);
      didCancel = true;
    }
    if (toolModeRef.current === 'demolish' || toolModeRef.current === 'road') {
      toolModeRef.current = 'expand';
      setToolMode('expand');
      controllerRef.current?.setToolMode('expand');
      didCancel = true;
    }
    if (didCancel) {
      gameAudio.playCycle();
    }
  }, [clearCommandMode, setSelectedHexSynced]);

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
    commandSourceRef.current = null;
    setCommandSource(null);
    toolModeRef.current = 'build';
    setToolMode('build');
    controllerRef.current?.setToolMode('build');

    const contextualOpts = contextualBuildRef.current?.options ?? [];
    const pool =
      contextualOpts.length > 0
        ? contextualOpts.map((opt) => opt.assetIndex)
        : CONSTRUCTIBLE_INDEXES;

    setSelectedIndex((prev) => {
      if (pool.length === 0) return prev;
      const curPos = pool.indexOf(prev);
      const nextPos =
        curPos === -1
          ? 0
          : (curPos + (delta >= 0 ? 1 : -1) + pool.length) % pool.length;
      const next = pool[nextPos];
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

  const handleSetToolMode = useCallback(
    (mode: BuilderToolMode) => {
      if (mode !== 'command' && commandSourceRef.current) {
        commandSourceRef.current = null;
        setCommandSource(null);
        syncSceneUnits(kingdomStateRef.current, null);
      }
      toolModeRef.current = mode;
      setToolMode(mode);
      controllerRef.current?.setToolMode(mode);
    },
    [syncSceneUnits]
  );

  const handleBuildOptionAtSelected = useCallback(
    (structureIndex: number) => {
      setSelectedIndex(structureIndex);
      selectedIndexRef.current = structureIndex;
      controllerRef.current?.setSelectedPiece(structureIndex, rotationDegRef.current);

      const coord = selectedHexRef.current;
      if (!coord) {
        handleSetToolMode('build');
        gameAudio.playCycle();
        return;
      }

      const res = buildInKingdom(
        kingdomStateRef.current,
        coord.q,
        coord.r,
        structureIndex,
        rotationDegRef.current,
        HEX_ASSETS
      );
      if (!res.built) {
        gameAudio.playError();
        if (res.messagePt) showToast(res.messagePt);
        return;
      }

      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      buildSheetOpenRef.current = false;
      setBuildSheetOpen(false);
      toolModeRef.current = 'expand';
      setToolMode('expand');
      controllerRef.current?.setToolMode('expand');
      gameAudio.playPlace();
      const under = getUnderConstructionKeys(res.nextState);
      const upgrading = getUpgradingKeysSet(res.nextState);
      controllerRef.current?.syncWorldState(
        res.nextState.worldState,
        [hexKey(coord.q, coord.r)],
        undefined,
        under,
        undefined,
        upgrading
      );
      syncSceneRoadsAndCities(res.nextState, under);
      if (res.messagePt) showToast(res.messagePt);
    },
    [handleSetToolMode, showToast, syncSceneRoadsAndCities]
  );

  const handleAdvanceTurn = useCallback(() => {
    const res = advanceKingdomTurn(kingdomStateRef.current, HEX_ASSETS);
    kingdomStateRef.current = res.nextState;
    setKingdomState(res.nextState);
    if (commandSourceRef.current) {
      clearCommandMode(res.nextState);
    } else {
      syncSceneUnits(res.nextState, null);
    }
    syncSceneAtmosphere(res.nextState, false);
    const waveKeys = [...res.incorporatedKeys, ...res.conqueredByAiKeys];
    const under = getUnderConstructionKeys(res.nextState);
    const upgrading = getUpgradingKeysSet(res.nextState);
    controllerRef.current?.syncWorldState(
      res.nextState.worldState,
      undefined,
      waveKeys.length > 0 ? waveKeys : undefined,
      under,
      undefined,
      upgrading
    );
    syncSceneRoadsAndCities(res.nextState, under);
    if (
      res.completedTech ||
      res.newEvent ||
      res.completedBuildings.length > 0 ||
      res.completedUpgrades.length > 0 ||
      res.incorporatedKeys.length > 0 ||
      res.foundedCities.length > 0 ||
      res.leveledUpCities.length > 0
    ) {
      gameAudio.playConquest();
    } else {
      gameAudio.playSaveChime();
    }
    showToast(res.headlinePt);
  }, [
    clearCommandMode,
    showToast,
    syncSceneAtmosphere,
    syncSceneRoadsAndCities,
    syncSceneUnits,
  ]);

  // Optional auto-turn timer
  useEffect(() => {
    if (!autoTurnEnabled || gameState !== 'playing' || kingdomModalOpen) return;
    const timer = window.setInterval(() => {
      handleAdvanceTurn();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [autoTurnEnabled, gameState, handleAdvanceTurn, kingdomModalOpen]);

  const handleSelectTech = useCallback(
    (techId: TechId) => {
      const res = setActiveResearchInKingdom(kingdomStateRef.current, techId);
      if (!res.selected) {
        gameAudio.playError();
        showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playCycle();
      showToast(res.messagePt);
    },
    [showToast]
  );

  const handleRecruitUnit = useCallback(
    (unitType: UnitType) => {
      const coord = selectedHexRef.current;
      if (!coord) return;
      const res = recruitUnitInKingdom(
        kingdomStateRef.current,
        coord.q,
        coord.r,
        unitType,
        HEX_ASSETS
      );
      if (!res.recruited) {
        gameAudio.playError();
        showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      syncSceneUnits(res.nextState, commandSourceRef.current);
      gameAudio.playPlace();
      showToast(res.messagePt);
    },
    [showToast, syncSceneUnits]
  );

  const handleStartUnitCommand = useCallback(() => {
    const coord = selectedHexRef.current;
    if (!coord) return;
    const unit = getUnitAt(kingdomStateRef.current.units, coord.q, coord.r);
    if (!unit || unit.owner !== 'player') return;
    if (unit.movedThisTurn) {
      gameAudio.playError();
      showToast('Esta unidade já agiu neste turno. Avance o turno.');
      return;
    }
    commandSourceRef.current = coord;
    setCommandSource(coord);
    toolModeRef.current = 'command';
    setToolMode('command');
    controllerRef.current?.setToolMode('command');
    syncSceneUnits(kingdomStateRef.current, coord);
    gameAudio.playCycle();
    showToast('Toque em um hexágono adjacente verde/vermelho para mover ou atacar.');
  }, [showToast, syncSceneUnits]);

  const handleDiplomacy = useCallback(
    (factionId: string, action: 'truce' | 'trade_pact' | 'war') => {
      const res = performDiplomacyAction(kingdomStateRef.current, factionId, action);
      if (!res.success) {
        gameAudio.playError();
        showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playSaveChime();
      showToast(res.messagePt);
    },
    [showToast]
  );

  const handleResolveEvent = useCallback(
    (choiceId: string) => {
      const res = resolveKingdomEvent(kingdomStateRef.current, choiceId, HEX_ASSETS);
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playConquest();
      showToast(res.outcomePt);
    },
    [showToast]
  );

  const handleTradeResource = useCallback(
    (resource: TradableResource, action: 'buy' | 'sell', quantity: number) => {
      const res = tradeResourceInKingdom(
        kingdomStateRef.current,
        resource,
        action,
        quantity,
        HEX_ASSETS
      );
      if (!res.success) {
        gameAudio.playError();
        showToast(res.messagePt);
        return;
      }
      kingdomStateRef.current = res.nextState;
      setKingdomState(res.nextState);
      gameAudio.playSaveChime();
      showToast(res.messagePt);
    },
    [showToast]
  );

  const handleFocusUnit = useCallback(
    (unit: UnitEntity) => {
      setKingdomModalOpen(false);
      setSelectedHexSynced({ q: unit.q, r: unit.r });
      if (!unit.movedThisTurn) {
        const coord = { q: unit.q, r: unit.r };
        commandSourceRef.current = coord;
        setCommandSource(coord);
        toolModeRef.current = 'command';
        setToolMode('command');
        controllerRef.current?.setToolMode('command');
        syncSceneUnits(kingdomStateRef.current, coord);
      } else {
        handleSetToolMode('expand');
      }
    },
    [handleSetToolMode, setSelectedHexSynced, syncSceneUnits]
  );

  const handleOpenKingdomModal = useCallback((tab: KingdomModalTab = 'economy') => {
    setKingdomModalTab(tab);
    setKingdomModalOpen(true);
  }, []);

  const handleSaveMap = useCallback(() => {
    try {
      const serialized = serializeKingdomState(kingdomStateRef.current);
      window.localStorage.setItem(STORAGE_KEY, serialized);
      gameAudio.playSaveChime();
      showToast('Reino salvo localmente');
    } catch {
      showToast('Não foi possível salvar no navegador');
    }
  }, [showToast]);

  const handleLoadMap = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        showToast('Nenhum reino salvo ainda');
        return;
      }
      const loaded = deserializeKingdomState(raw, HEX_ASSETS.length);
      if (!loaded) {
        showToast('Arquivo salvo inválido');
        return;
      }
      kingdomStateRef.current = loaded;
      setKingdomState(loaded);
      setSelectedHexSynced(null);
      clearCommandMode(loaded);
      controllerRef.current?.setHomeCoord(loaded.playerCapital ?? { q: 0, r: 0 }, true);
      syncSceneAtmosphere(loaded, true);
      const under = getUnderConstructionKeys(loaded);
      const upgrading = getUpgradingKeysSet(loaded);
      controllerRef.current?.syncWorldState(
        loaded.worldState,
        undefined,
        undefined,
        under,
        undefined,
        upgrading
      );
      syncSceneRoadsAndCities(loaded, under);
      syncSceneUnits(loaded, null);
      controllerRef.current?.centerCamera();
      gameAudio.playSaveChime();
      showToast('Reino carregado');
    } catch {
      showToast('Erro ao carregar reino');
    }
  }, [
    clearCommandMode,
    setSelectedHexSynced,
    showToast,
    syncSceneAtmosphere,
    syncSceneRoadsAndCities,
    syncSceneUnits,
  ]);

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
    setKingdomModalOpen(false);
    setGameState('paused');
  }, []);

  const handleBackToTitle = useCallback(() => {
    buildSheetOpenRef.current = false;
    setBuildSheetOpen(false);
    setKingdomModalOpen(false);
    setSelectedHexSynced(null);
    clearCommandMode();
    setGameState('title');
  }, [clearCommandMode, setSelectedHexSynced]);

  const handleResetStarter = useCallback(() => {
    const currentSeed = kingdomStateRef.current.worldSeed;
    const starter = createStarterKingdomState(HEX_ASSETS, currentSeed);
    kingdomStateRef.current = starter;
    setKingdomState(starter);
    setSelectedHexSynced(null);
    clearCommandMode(starter);
    controllerRef.current?.setHomeCoord(starter.playerCapital ?? { q: 0, r: 0 }, true);
    syncSceneAtmosphere(starter, true);
    const under = getUnderConstructionKeys(starter);
    const upgrading = getUpgradingKeysSet(starter);
    controllerRef.current?.syncWorldState(
      starter.worldState,
      undefined,
      undefined,
      under,
      undefined,
      upgrading
    );
    syncSceneRoadsAndCities(starter, under);
    syncSceneUnits(starter, null);
    controllerRef.current?.centerCamera();
    setGameState('playing');
    showToast('Reino inicial restaurado');
  }, [
    clearCommandMode,
    setSelectedHexSynced,
    showToast,
    syncSceneAtmosphere,
    syncSceneRoadsAndCities,
    syncSceneUnits,
  ]);

  const handleNewProceduralWorld = useCallback(() => {
    const newSeed = createRandomWorldSeed();
    const starter = createStarterKingdomState(HEX_ASSETS, newSeed);
    kingdomStateRef.current = starter;
    setKingdomState(starter);
    setSelectedHexSynced(null);
    clearCommandMode(starter);
    controllerRef.current?.setHomeCoord(starter.playerCapital ?? { q: 0, r: 0 }, true);
    syncSceneAtmosphere(starter, true);
    const under = getUnderConstructionKeys(starter);
    const upgrading = getUpgradingKeysSet(starter);
    controllerRef.current?.syncWorldState(
      starter.worldState,
      undefined,
      undefined,
      under,
      undefined,
      upgrading
    );
    syncSceneRoadsAndCities(starter, under);
    syncSceneUnits(starter, null);
    controllerRef.current?.centerCamera();
    setGameState('playing');
    showToast(`Novo mundo gerado (#${newSeed})`);
  }, [
    clearCommandMode,
    setSelectedHexSynced,
    showToast,
    syncSceneAtmosphere,
    syncSceneRoadsAndCities,
    syncSceneUnits,
  ]);

  const handleClearMap = useCallback(() => {
    const empty = createSandboxKingdomState();
    kingdomStateRef.current = empty;
    setKingdomState(empty);
    setSelectedHexSynced(null);
    clearCommandMode(empty);
    controllerRef.current?.setHomeCoord({ q: 0, r: 0 }, true);
    syncSceneAtmosphere(empty, true);
    const under = getUnderConstructionKeys(empty);
    const upgrading = getUpgradingKeysSet(empty);
    controllerRef.current?.syncWorldState(
      empty.worldState,
      undefined,
      undefined,
      under,
      undefined,
      upgrading
    );
    syncSceneRoadsAndCities(empty, under);
    syncSceneUnits(empty, null);
    controllerRef.current?.centerCamera();
    setGameState('playing');
    showToast('Mapa limpo — modo livre');
  }, [
    clearCommandMode,
    setSelectedHexSynced,
    showToast,
    syncSceneAtmosphere,
    syncSceneRoadsAndCities,
    syncSceneUnits,
  ]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      gameAudio.setMuted(next);
      return next;
    });
  }, []);

  const handleToggleAutoTurn = useCallback(() => {
    setAutoTurnEnabled((prev) => !prev);
  }, []);

  const handleToggleDock = useCallback(() => {
    setDockOpen((prev) => !prev);
  }, []);

  const handleSetBuildSheetOpen = useCallback((open: boolean) => {
    buildSheetOpenRef.current = open;
    setBuildSheetOpen(open);
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
      onHoverChange: () => {},
      onPlaceAt: handlePlaceAt,
      onRoadAt: handleRoadAt,
      onDemolishAt: handleDemolishAt,
      onTouchTapAt: handleTouchTapAt,
      onSelectHexAt: handleSelectHexAt,
      onRotate: handleRotatePiece,
      onCycleStructure: handleCyclePiece,
      onLoadProgress: () => {},
    });

    controllerRef.current = controller;
    controller.setHomeCoord(kingdomStateRef.current.playerCapital ?? { q: 0, r: 0 }, true);
    controller.setGameState(gameStateRef.current);
    controller.setToolMode(toolModeRef.current);
    controller.setSelectedPiece(selectedIndexRef.current, rotationDegRef.current);
    const initCal =
      kingdomStateRef.current.calendar ??
      computeCalendarSnapshot(kingdomStateRef.current.turn);
    const initPhase =
      kingdomStateRef.current.dayPhase ??
      getDayPhaseForTurn(kingdomStateRef.current.turn);
    const initWeather = (
      kingdomStateRef.current.climateWeather ?? createInitialClimateWeather()
    ).id;
    controller.setAtmosphereState({
      phase: initPhase,
      season: initCal.season,
      seasonProgress: initCal.seasonProgress,
      weather: initWeather,
      worldSeed:
        kingdomStateRef.current.worldSeed ??
        kingdomStateRef.current.worldState.seed,
      snap: true,
    });
    const under = getUnderConstructionKeys(kingdomStateRef.current);
    const upgrading = getUpgradingKeysSet(kingdomStateRef.current);
    controller.syncWorldState(
      kingdomStateRef.current.worldState,
      undefined,
      undefined,
      under,
      undefined,
      upgrading
    );
    controller.syncRoadsAndCities({
      roads: kingdomStateRef.current.roads ?? {},
      cities: kingdomStateRef.current.cities ?? [],
      connectivity: getKingdomRoadSummary(kingdomStateRef.current, HEX_ASSETS),
      worldState: kingdomStateRef.current.worldState,
      underConstructionKeys: under,
    });
    controller.syncUnits(kingdomStateRef.current.units, null, []);

    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      controller.dispose();
      controllerRef.current = null;
    };
  }, [
    handlePlaceAt,
    handleRoadAt,
    handleDemolishAt,
    handleTouchTapAt,
    handleSelectHexAt,
    handleRotatePiece,
    handleCyclePiece,
  ]);

  // Unified keyboard bindings
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
        if (kingdomModalOpenRef.current) {
          setKingdomModalOpen(false);
          return;
        }
        if (
          buildSheetOpenRef.current ||
          selectedHexRef.current ||
          commandSourceRef.current
        ) {
          handleCancelAction();
          return;
        }
        setGameState((curr) => (curr === 'playing' ? 'paused' : 'playing'));
        return;
      }

      if (e.code === 'KeyP') {
        e.preventDefault();
        setKingdomModalOpen(false);
        setGameState((curr) => (curr === 'playing' ? 'paused' : 'playing'));
        return;
      }

      if (state !== 'playing' || kingdomModalOpenRef.current) return;

      if (e.code === 'KeyQ') {
        e.preventDefault();
        handleCyclePiece(-1);
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        handleCyclePiece(1);
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        handleRotatePiece();
      } else if (e.code === 'Space') {
        e.preventDefault();
        handleAdvanceTurn();
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
    handleAdvanceTurn,
    handleStartGame,
    handleCancelAction,
    handleCyclePiece,
    handleRotatePiece,
    handleDemolishAt,
    handleSaveMap,
    handleLoadMap,
    handleToggleMute,
  ]);

  const worldState = kingdomState.worldState;

  const territoryCount = useMemo(
    () => countPlayerTerritory(worldState),
    [worldState]
  );

  const economy = useMemo(
    () => getKingdomEconomy(kingdomState, HEX_ASSETS),
    [kingdomState]
  );

  const territorySummary = useMemo(
    () => getKingdomTerritoryCapacity(kingdomState, HEX_ASSETS),
    [kingdomState]
  );

  const expansionOverlayData = useMemo(() => {
    const underKeys = getUnderConstructionKeys(kingdomState);
    const activeExp = kingdomState.expansions ?? [];
    const roads = kingdomState.roads ?? {};
    const cities = kingdomState.cities ?? [];
    const expandable = getExpandableFrontierCoords({
      worldState,
      activeExpansions: activeExp,
      population: kingdomState.population,
      unlockedTechs: kingdomState.research.unlocked,
      availableWorkers: economy.population.availableWorkers,
      assets: HEX_ASSETS,
      owner: 'player',
      underConstructionKeys: underKeys,
      playerCapital: kingdomState.playerCapital,
      roads,
      roadConnectivity: economy.roadConnectivity,
      cities,
    });
    const expandableKeys = new Set(expandable.map((c) => hexKey(c.q, c.r)));
    const expandingKeys = new Set(
      activeExp.filter((e) => e.owner === 'player').map((e) => hexKey(e.q, e.r))
    );
    const coverage = getInfluenceCoverageCoords({
      worldState,
      activeExpansions: activeExp,
      population: kingdomState.population,
      unlockedTechs: kingdomState.research.unlocked,
      assets: HEX_ASSETS,
      owner: 'player',
      underConstructionKeys: underKeys,
      playerCapital: kingdomState.playerCapital,
      roads,
      roadConnectivity: economy.roadConnectivity,
      cities,
    });
    const influenceKeys = new Set<string>();
    for (const c of coverage) {
      const k = hexKey(c.q, c.r);
      if (!expandableKeys.has(k) && !expandingKeys.has(k)) {
        influenceKeys.add(k);
      }
    }
    return { expandableKeys, expandingKeys, influenceKeys };
  }, [
    economy.population.availableWorkers,
    economy.roadConnectivity,
    kingdomState,
    worldState,
  ]);

  useEffect(() => {
    controllerRef.current?.setAttentionKeys(economy.attentionHexKeys);
  }, [economy.attentionHexKeys]);

  useEffect(() => {
    controllerRef.current?.syncExpansionOverlay(expansionOverlayData);
  }, [expansionOverlayData]);

  const progression = useMemo(
    () => getKingdomProgression(kingdomState, HEX_ASSETS),
    [kingdomState]
  );

  const market = useMemo(
    () => getKingdomMarket(kingdomState, HEX_ASSETS),
    [kingdomState]
  );

  const selectedTileAssetName = useMemo(() => {
    if (!selectedHex) return null;
    const existing = worldState.hexes[hexKey(selectedHex.q, selectedHex.r)];
    if (!existing) return null;
    return HEX_ASSETS[existing.structureIndex]?.name ?? null;
  }, [selectedHex, worldState.hexes]);

  const selectedHexHasConstruction = useMemo(() => {
    if (!selectedHex) return false;
    return hasHexConstruction(
      worldState.hexes[hexKey(selectedHex.q, selectedHex.r)],
      HEX_ASSETS
    );
  }, [selectedHex, worldState.hexes]);

  const selectedHexConstruction = useMemo(() => {
    if (!selectedHex) return null;
    return getConstructionAt(kingdomState, selectedHex.q, selectedHex.r);
  }, [kingdomState, selectedHex]);

  const selectedHexActiveExpansion = useMemo(() => {
    if (!selectedHex) return null;
    return getExpansionAt(kingdomState, selectedHex.q, selectedHex.r);
  }, [kingdomState, selectedHex]);

  const selectedHexOwned = useMemo(() => {
    if (!selectedHex) return true;
    return getHexOwner(worldState, selectedHex.q, selectedHex.r) === 'player';
  }, [selectedHex, worldState]);

  const selectedExpansion = useMemo(() => {
    if (!selectedHex) return null;
    return evaluateExpansionInKingdom(
      kingdomState,
      selectedHex.q,
      selectedHex.r,
      HEX_ASSETS
    );
  }, [kingdomState, selectedHex]);

  const selectedTerrainInfo = useMemo(() => {
    if (!selectedHex) return null;
    const existing = worldState.hexes[hexKey(selectedHex.q, selectedHex.r)];
    const info = getHexTerrainAndResource(selectedHex.q, selectedHex.r, existing);
    return describeTerrain(info.terrainType);
  }, [selectedHex, worldState.hexes]);

  const selectedStrategicInfo = useMemo(() => {
    if (!selectedHex) return null;
    const existing = worldState.hexes[hexKey(selectedHex.q, selectedHex.r)];
    return getStrategicRegionInfo(selectedHex.q, selectedHex.r, existing);
  }, [selectedHex, worldState.hexes]);

  const selectedHexUnit = useMemo(() => {
    if (!selectedHex) return null;
    return getUnitAt(kingdomState.units, selectedHex.q, selectedHex.r) ?? null;
  }, [kingdomState.units, selectedHex]);

  const selectedHexFaction = useMemo(() => {
    if (
      !selectedExpansion ||
      selectedExpansion.owner === 'player' ||
      selectedExpansion.owner === 'neutral'
    ) {
      return null;
    }
    return kingdomState.factions.find((f) => f.id === selectedExpansion.owner) ?? null;
  }, [kingdomState.factions, selectedExpansion]);

  const selectedBuildingReport = useMemo(() => {
    if (!selectedHex) return null;
    return economy.buildingsByKey[hexKey(selectedHex.q, selectedHex.r)] ?? null;
  }, [economy.buildingsByKey, selectedHex]);

  const contextualBuild = useMemo<HexBuildEvaluation | null>(() => {
    if (!selectedHex) return null;
    return evaluateHexBuildOptions({
      worldState,
      resources: kingdomState.resources,
      unlockedTechs: kingdomState.research.unlocked,
      economy,
      hasActiveConstructionAtCoord: Boolean(selectedHexConstruction),
      q: selectedHex.q,
      r: selectedHex.r,
      assets: HEX_ASSETS,
    });
  }, [
    economy,
    kingdomState.research.unlocked,
    kingdomState.resources,
    selectedHex,
    selectedHexConstruction,
    worldState,
  ]);

  useEffect(() => {
    contextualBuildRef.current = contextualBuild;
  }, [contextualBuild]);

  const canBuildActiveOnSelected = useMemo(() => {
    if (!selectedHex) return true;
    return validateBuildCandidateOnHex({
      worldState,
      resources: kingdomState.resources,
      unlockedTechs: kingdomState.research.unlocked,
      availableWorkers: economy.population.availableWorkers,
      hasActiveConstructionAtCoord: Boolean(selectedHexConstruction),
      q: selectedHex.q,
      r: selectedHex.r,
      structureIndex: selectedIndex,
      assets: HEX_ASSETS,
      checkAffordability: false,
    }).allowed;
  }, [
    economy.population.availableWorkers,
    kingdomState.research.unlocked,
    kingdomState.resources,
    selectedHex,
    selectedHexConstruction,
    selectedIndex,
    worldState,
  ]);

  const activeBuildEffectiveCost = useMemo(() => {
    const asset = HEX_ASSETS[selectedIndex];
    if (!asset) return null;
    return computeEffectiveBuildCost(asset.name, kingdomState.research.unlocked);
  }, [kingdomState.research.unlocked, selectedIndex]);

  const selectedCity = useMemo<CityEntity | null>(() => {
    if (!selectedHex) return null;
    return getCityAtCoord(kingdomState.cities, selectedHex.q, selectedHex.r);
  }, [kingdomState.cities, selectedHex]);

  useEffect(() => {
    if (!selectedCity) {
      controllerRef.current?.syncSelectedCityRegion({ regionKeys: [], districtKeys: [] });
      return;
    }
    const regionKeys =
      economy.regionalSummary?.regionHexKeysByCityId[selectedCity.id] ??
      selectedCity.regionHexKeys ??
      [];
    const districtKeys = Array.from(
      new Set(selectedCity.districts.flatMap((d) => d.hexKeys))
    );
    controllerRef.current?.syncSelectedCityRegion({ regionKeys, districtKeys });
  }, [economy.regionalSummary, selectedCity]);

  const selectedRoad = useMemo<RoadTile | null>(() => {
    if (!selectedHex) return null;
    return getRoadAt(kingdomState.roads, selectedHex.q, selectedHex.r);
  }, [kingdomState.roads, selectedHex]);

  const selectedRoadCheck = useMemo<{
    allowed: boolean;
    isUpgrade: boolean;
    definition: RoadLevelDefinition | null;
    reasonPt: string | null;
  } | null>(() => {
    if (!selectedHex) return null;
    return canBuildOrUpgradeRoad({
      worldState,
      roads: kingdomState.roads,
      q: selectedHex.q,
      r: selectedHex.r,
      cash: worldState.cash,
      resources: kingdomState.resources,
      unlockedTechs: kingdomState.research.unlocked,
      assets: HEX_ASSETS,
      underConstructionKeys: getUnderConstructionKeys(kingdomState),
    });
  }, [kingdomState, selectedHex, worldState]);

  const calendar = useMemo(
    () => kingdomState.calendar ?? computeCalendarSnapshot(kingdomState.turn),
    [kingdomState.calendar, kingdomState.turn]
  );

  const dayPhase = kingdomState.dayPhase ?? getDayPhaseForTurn(kingdomState.turn);
  const climateWeather =
    kingdomState.climateWeather ?? createInitialClimateWeather();

  const selectedBuildingLevel = useMemo(() => {
    if (!selectedHex) return 1;
    const tile = worldState.hexes[hexKey(selectedHex.q, selectedHex.r)];
    return getBuildingLevel(tile);
  }, [selectedHex, worldState.hexes]);

  const selectedUpgradeEvaluation = useMemo<BuildingUpgradeEvaluation | null>(() => {
    if (!selectedHex || !selectedHexHasConstruction) return null;
    return evaluateBuildingUpgradeInKingdom(
      kingdomState,
      selectedHex.q,
      selectedHex.r,
      HEX_ASSETS
    );
  }, [kingdomState, selectedHex, selectedHexHasConstruction]);

  return (
    <div className="fixed inset-0 h-[100dvh] w-screen overflow-hidden bg-[#9bd2ee] hex-game-viewport">
      {/* Isolated WebGL canvas mount container */}
      <div
        ref={canvasMountRef}
        data-testid="hex-webgl-canvas"
        className="w-full h-full touch-none"
      />

      {/* HUD overlay */}
      <GameHud
        gameState={gameState}
        turn={kingdomState.turn}
        calendar={calendar}
        dayPhase={dayPhase}
        climateWeather={climateWeather}
        worldSeed={kingdomState.worldSeed}
        cash={worldState.cash}
        territoryCount={territoryCount}
        territorySummary={territorySummary}
        resources={kingdomState.resources}
        economy={economy}
        cities={kingdomState.cities ?? []}
        stage={progression.stage}
        unlockedTechs={kingdomState.research.unlocked}
        activeEvent={kingdomState.activeEvent}
        activeEffects={kingdomState.activeEffects}
        autoTurnEnabled={autoTurnEnabled}
        commandModeActive={toolMode === 'command' && commandSource !== null}
        selectedIndex={selectedIndex}
        toolMode={toolMode}
        selectedHex={selectedHex}
        selectedHexOwned={selectedHexOwned}
        selectedHexHasConstruction={selectedHexHasConstruction}
        selectedHexConstruction={selectedHexConstruction}
        selectedHexActiveExpansion={selectedHexActiveExpansion}
        selectedTileAssetName={selectedTileAssetName}
        selectedBuildingLevel={selectedBuildingLevel}
        selectedUpgradeEvaluation={selectedUpgradeEvaluation}
        selectedExpansion={selectedExpansion}
        selectedTerrainInfo={selectedTerrainInfo}
        selectedStrategicInfo={selectedStrategicInfo}
        selectedHexUnit={selectedHexUnit}
        selectedHexFaction={selectedHexFaction}
        selectedBuildingReport={selectedBuildingReport}
        selectedCity={selectedCity}
        selectedRoad={selectedRoad}
        selectedRoadCheck={selectedRoadCheck}
        contextualBuild={contextualBuild}
        canBuildActiveOnSelected={canBuildActiveOnSelected}
        activeBuildEffectiveCost={activeBuildEffectiveCost}
        assets={HEX_ASSETS}
        muted={muted}
        dockOpen={dockOpen}
        buildSheetOpen={buildSheetOpen}
        toastMessage={toastMessage}
        onStartGame={handleStartGame}
        onResume={handleResume}
        onPause={handlePause}
        onBackToTitle={handleBackToTitle}
        onResetStarter={handleResetStarter}
        onNewProceduralWorld={handleNewProceduralWorld}
        onClearMap={handleClearMap}
        onAdvanceTurn={handleAdvanceTurn}
        onToggleAutoTurn={handleToggleAutoTurn}
        onOpenKingdomModal={handleOpenKingdomModal}
        onSelectPiece={handleSelectPiece}
        onBuildOptionOnSelected={handleBuildOptionAtSelected}
        onCyclePiece={handleCyclePiece}
        onRotatePiece={handleRotatePiece}
        onSetToolMode={handleSetToolMode}
        onConfirmSelectedHex={handleConfirmSelectedHex}
        onBuildRoadSelected={handleBuildRoadSelected}
        onUpgradeSelectedHex={handleUpgradeSelectedHex}
        onDemolishSelectedHex={handleDemolishSelectedHex}
        onRecruitUnit={handleRecruitUnit}
        onStartUnitCommand={handleStartUnitCommand}
        onCancelAction={handleCancelAction}
        onSaveMap={handleSaveMap}
        onLoadMap={handleLoadMap}
        onToggleMute={handleToggleMute}
        onToggleDock={handleToggleDock}
        onSetBuildSheetOpen={handleSetBuildSheetOpen}
        onCenterCamera={handleCenterCamera}
        onZoom={handleZoom}
        onRotateCamera={handleRotateCamera}
      />

      {/* Strategy Overview / Trade / Research / Military / Diplomacy Modal */}
      <KingdomModal
        open={kingdomModalOpen}
        initialTab={kingdomModalTab}
        kingdomState={kingdomState}
        economy={economy}
        territorySummary={territorySummary}
        market={market}
        stage={progression.stage}
        militaryPower={progression.military}
        onClose={() => setKingdomModalOpen(false)}
        onSelectTech={handleSelectTech}
        onResolveEvent={handleResolveEvent}
        onDiplomacy={handleDiplomacy}
        onTrade={handleTradeResource}
        onFocusUnit={handleFocusUnit}
      />
    </div>
  );
}
