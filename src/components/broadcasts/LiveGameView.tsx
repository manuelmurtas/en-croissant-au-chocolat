import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color } from "@lichess-org/chessground/types";
import { makeSquare, type NormalMove, parseUci } from "chessops";
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import {
  IconArrowsExchange,
  IconCheck,
  IconCopy,
  IconCpu,
  IconExternalLink,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconSettings,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr/immutable";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { BestMoves, Score } from "@/bindings";
import { Chessground } from "@/chessground/Chessground";
import EvalBar from "@/components/boards/EvalBar";
import EvalListener from "@/components/boards/EvalListener";
import { TreeStateContext, TreeStateProvider } from "@/components/common/TreeStateContext";
import FideInfo from "@/components/databases/FideInfo";
import ScoreBubble from "@/components/panels/analysis/ScoreBubble";
import {
  activeTabAtom,
  bestMovesFamily,
  type BroadcastEngineMode,
  broadcastEngineModeAtom,
  broadcastEvalDepthAtom,
  enableAllAtom,
  engineMovesFamily,
  engineProgressFamily,
  enginesAtom,
  tabEngineSettingsFamily,
} from "@/state/atoms";
import { getVariationLine, parsePGN } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import { type LocalEngine, stopEngine } from "@/utils/engines";
import { formatNodes } from "@/utils/format";
import { getFidePlayer } from "@/utils/lichess/api";
import type { BroadcastGameSummary } from "@/utils/lichess/broadcast";
import { formatScore } from "@/utils/score";
import { playSound } from "@/utils/sound";
import type { TreeNode, TreeState } from "@/utils/treeReducer";
import BroadcastEngineSettingsModal from "./BroadcastEngineSettingsModal";
import classes from "./Broadcasts.module.css";

interface LiveGameViewProps {
  game: BroadcastGameSummary;
  tourName?: string;
  onOpenAnalysisTab?: (pgn: string, name: string) => void;
}

function getEndPosition(root: TreeNode): number[] {
  const path: number[] = [];
  let curr = root;
  while (curr && curr.children && curr.children.length > 0) {
    path.push(0);
    curr = curr.children[0];
  }
  return path;
}

export default function LiveGameView({
  game,
  tourName,
  onOpenAnalysisTab,
}: LiveGameViewProps) {
  const [initialTree, setInitialTree] = useState<TreeState | null>(null);

  // Parse initial PGN when game.id changes and set position directly to the end of the mainline
  useEffect(() => {
    let cancelled = false;
    setInitialTree(null);
    parsePGN(game.pgn).then((tree) => {
      if (!cancelled) {
        tree.position = getEndPosition(tree.root);
        setInitialTree(tree);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [game.id]);

  if (!initialTree) {
    return (
      <Box
        h="100%"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Loader size="md" />
      </Box>
    );
  }

  return (
    <TreeStateProvider key={game.id} initial={initialTree}>
      <LiveGameContent
        game={game}
        tourName={tourName}
        onOpenAnalysisTab={onOpenAnalysisTab}
      />
    </TreeStateProvider>
  );
}

function parseLichessEvalToScore(evalStr?: string): Score | null {
  if (!evalStr) return null;
  if (evalStr.startsWith("#")) {
    const mate = parseInt(evalStr.slice(1), 10);
    return { value: { type: "mate", value: isNaN(mate) ? 1 : mate }, wdl: null };
  }
  const cp = parseFloat(evalStr);
  if (isNaN(cp)) return null;
  return { value: { type: "cp", value: Math.round(cp * 100) }, wdl: null };
}

function LiveGameContent({
  game,
  tourName,
  onOpenAnalysisTab,
}: {
  game: BroadcastGameSummary;
  tourName?: string;
  onOpenAnalysisTab?: (pgn: string, name: string) => void;
}) {
  const store = useContext(TreeStateContext)!;
  const currentNode = useStore(store, (s) => s.currentNode());
  const rootNode = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);

  const endPosition = useMemo(() => getEndPosition(rootNode), [rootNode]);
  const isAtLatest = useMemo(() => {
    if (position.length !== endPosition.length) return false;
    return position.every((val, idx) => val === endPosition[idx]);
  }, [position, endPosition]);

  // Live PGN polling updater: seamlessly update moves without unmounting
  const prevPgnRef = useRef(game.pgn);
  useEffect(() => {
    if (game.pgn === prevPgnRef.current) return;
    prevPgnRef.current = game.pgn;

    parsePGN(game.pgn).then((newTree) => {
      const storeState = store.getState();
      const currentPos = storeState.position;
      const currentEndPos = getEndPosition(storeState.root);

      const wasAtLatest =
        currentPos.length === currentEndPos.length &&
        currentPos.every((val, idx) => val === currentEndPos[idx]);

      const newEndPos = getEndPosition(newTree.root);

      // Play subtle move sound if a new live move arrived while user was following live
      if (newEndPos.length > currentEndPos.length && wasAtLatest) {
        playSound(false, false);
      }

      store.setState({
        root: newTree.root,
        headers: newTree.headers,
        position: wasAtLatest ? newEndPos : currentPos,
      });
    });
  }, [game.pgn, store]);

  const variationMoves = useStore(
    store,
    useShallow((s) => getVariationLine(s.root, s.position)),
  );

  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  useEffect(() => {
    setActiveTab("broadcast");
  }, [setActiveTab]);

  const [orientation, setOrientation] = useState<Color>("white");
  const [copied, setCopied] = useState(false);
  const [engines] = useAtom(enginesAtom);
  const [, enableAll] = useAtom(enableAllAtom);
  const [engineMode, setEngineMode] = useAtom(broadcastEngineModeAtom);
  const [evalDepth, setEvalDepth] = useAtom(broadcastEvalDepthAtom);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  const firstLoadedEngine = useMemo(() => {
    return (
      engines?.find((e) => e.loaded && e.type === "local") ||
      engines?.find((e) => e.loaded) ||
      null
    );
  }, [engines]);

  const [settings, setSettings] = useAtom(
    tabEngineSettingsFamily({
      engineId: firstLoadedEngine?.id || "",
      defaultSettings: firstLoadedEngine?.settings ?? undefined,
      defaultGo: firstLoadedEngine?.go ?? undefined,
      tab: "broadcast",
    }),
  );

  const stopAllEngines = useCallback(() => {
    for (const engine of engines?.filter((e) => e.loaded && e.type === "local") || []) {
      stopEngine(engine as LocalEngine, "broadcast");
    }
  }, [engines]);

  const handleModeChange = useCallback(
    (mode: BroadcastEngineMode) => {
      setEngineMode(mode);
      if (mode === "off") {
        setSettings((prev) => ({ ...prev, enabled: false }));
        enableAll(false);
        stopAllEngines();
      } else if (mode === "eval-bar") {
        setSettings((prev) => {
          const existing = prev.settings || [];
          const newSettings = existing.some((o) => o.name === "MultiPV")
            ? existing.map((o) => (o.name === "MultiPV" ? { ...o, value: 1 } : o))
            : [...existing, { name: "MultiPV", value: 1 }];
          return {
            ...prev,
            enabled: true,
            go: { t: "Depth", c: evalDepth },
            settings: newSettings,
          };
        });
        enableAll(true);
      } else if (mode === "full") {
        setSettings((prev) => ({
          ...prev,
          enabled: true,
        }));
        enableAll(true);
      }
    },
    [setEngineMode, setSettings, enableAll, stopAllEngines, evalDepth],
  );

  const handleEvalDepthChange = useCallback(
    (newDepth: number) => {
      setEvalDepth(newDepth);
      if (engineMode === "eval-bar") {
        setSettings((prev) => ({
          ...prev,
          go: { t: "Depth", c: newDepth },
        }));
      }
    },
    [engineMode, setEvalDepth, setSettings],
  );

  // Sync engine mode on mount and cleanup on unmount
  useEffect(() => {
    if (engineMode === "eval-bar") {
      setSettings((prev) => {
        const existing = prev.settings || [];
        const newSettings = existing.some((o) => o.name === "MultiPV")
          ? existing.map((o) => (o.name === "MultiPV" ? { ...o, value: 1 } : o))
          : [...existing, { name: "MultiPV", value: 1 }];
        return {
          ...prev,
          enabled: true,
          go: { t: "Depth", c: evalDepth },
          settings: newSettings,
        };
      });
      enableAll(true);
    } else if (engineMode === "full") {
      setSettings((prev) => ({ ...prev, enabled: true }));
      enableAll(true);
    } else {
      setSettings((prev) => ({ ...prev, enabled: false }));
      enableAll(false);
      stopAllEngines();
    }

    return () => {
      enableAll(false);
      stopAllEngines();
    };
  }, []);

  // Responsive board measurement
  const { ref: boardContainerRef, width: containerWidth, height: containerHeight } = useElementSize();
  const maxDimension = Math.min(
    Math.max(280, containerWidth - 70),
    Math.max(280, containerHeight - 120),
  );
  const boardSize = Math.max(300, Math.floor(maxDimension));

  // Determine turn
  const [pos] = positionFromFen(currentNode.fen);
  const turnColor: Color = pos?.turn === "black" ? "black" : "white";
  const isOngoing = game.result === "*";

  // Real-time ticking clocks
  const { formattedWhite, formattedBlack } = useLiveGameClocks({
    whiteClk: game.whiteClk,
    blackClk: game.blackClk,
    turn: turnColor,
    isOngoing,
  });

  // Navigation handlers
  const handleStart = () => store.getState().goToStart();
  const handlePrev = () => store.getState().goToPrevious();
  const handleNext = () => store.getState().goToNext();
  const handleEnd = () => store.getState().goToEnd();

  // Flip board
  const toggleOrientation = () => {
    setOrientation((o) => (o === "white" ? "black" : "white"));
  };

  // Copy PGN
  const copyPgn = () => {
    navigator.clipboard.writeText(game.pgn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Engine arrows on board
  const arrows = useAtomValue(
    bestMovesFamily({
      fen: rootNode.fen,
      gameMoves: variationMoves,
    }),
  );

  const engineShapes = useMemo((): DrawShape[] => {
    if (engineMode !== "full" || !arrows || arrows.size === 0) return [];
    const shapes: DrawShape[] = [];
    const entries = Array.from(arrows.entries()).sort((a, b) => a[0] - b[0]);
    for (const [i, moves] of entries) {
      if (i < 3 && moves.length > 0) {
        const topPv = moves[0].pv;
        if (topPv && topPv.length > 0) {
          const uci = topPv[0];
          const m = parseUci(uci) as NormalMove | undefined;
          if (m) {
            const from = makeSquare(m.from);
            const to = makeSquare(m.to);
            if (from && to) {
              shapes.push({
                orig: from,
                dest: to,
                brush: i === 0 ? "green" : "blue",
              });
            }
          }
        }
      }
    }
    return shapes;
  }, [engineMode, arrows]);

  // Extract flat main line moves for move list
  const movesList = useMemo(() => {
    const list: { ply: number; san: string; path: number[] }[] = [];
    let current: TreeNode | null = rootNode;
    let currentPath: number[] = [];
    let ply = 1;

    while (current && current.children.length > 0) {
      const nextNode: TreeNode | undefined = current.children[0];
      if (!nextNode) break;
      currentPath = [...currentPath, 0];
      if (nextNode.san) {
        list.push({ ply, san: nextNode.san, path: currentPath });
        ply++;
      }
      current = nextNode;
    }
    return list;
  }, [rootNode]);

  // Determine score to display in the EvalBar:
  // Prefer live local engine score when available, otherwise Lichess broadcast score
  const broadcastScore = useMemo(() => parseLichessEvalToScore(game.eval), [game.eval]);
  const displayScore = currentNode.score || broadcastScore;

  // Top/bottom player assignments based on orientation
  const topPlayer = orientation === "white" ? "black" : "white";
  const bottomPlayer = orientation === "white" ? "white" : "black";

  const [fideModalPlayer, setFideModalPlayer] = useState<string | null>(null);

  const getPlayerDetails = (side: "white" | "black") => {
    return {
      name: side === "white" ? game.white : game.black,
      title: side === "white" ? game.whiteTitle : game.blackTitle,
      elo: side === "white" ? game.whiteElo : game.blackElo,
      team: side === "white" ? game.whiteTeam : game.blackTeam,
      clk: side === "white" ? formattedWhite : formattedBlack,
      fideId: side === "white" ? game.whiteFideId : game.blackFideId,
    };
  };

  const topDetails = getPlayerDetails(topPlayer);
  const bottomDetails = getPlayerDetails(bottomPlayer);

  return (
    <Box h="100%" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Top Toolbar */}
      <Box p="xs" px="md" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs">
            <Badge size="md" variant="filled" color="dark">
              Board {game.boardNumber}
            </Badge>
            <Badge
              size="md"
              variant={game.result === "*" ? "light" : "filled"}
              color={game.result === "*" ? "blue" : "dark"}
            >
              {game.result}
            </Badge>
            {(game.opening || game.eco) && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {game.eco ? `${game.eco}: ` : ""}
                {game.opening}
              </Text>
            )}
          </Group>

          <Group gap="xs">
            {/* Engine Mode & Settings Controls */}
            <Group gap={4} wrap="nowrap">
              <SegmentedControl
                size="xs"
                value={engineMode}
                onChange={(val) => handleModeChange(val as BroadcastEngineMode)}
                data={[
                  { label: "Off", value: "off" },
                  { label: "Eval Bar", value: "eval-bar" },
                  { label: "Analysis", value: "full" },
                ]}
              />
              <Tooltip label="Engine Settings (Depth, Cores, Memory)">
                <ActionIcon
                  variant="default"
                  size="sm"
                  onClick={() => setSettingsModalOpen(true)}
                >
                  <IconSettings size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>

            <Tooltip label="Flip board">
              <ActionIcon variant="default" size="sm" onClick={toggleOrientation}>
                <IconArrowsExchange size={16} />
              </ActionIcon>
            </Tooltip>

            <Tooltip label={copied ? "Copied!" : "Copy PGN"}>
              <ActionIcon variant="default" size="sm" onClick={copyPgn}>
                {copied ? <IconCheck size={16} color="green" /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>

            {onOpenAnalysisTab && (
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconExternalLink size={14} />}
                onClick={() =>
                  onOpenAnalysisTab(game.pgn, `B${game.boardNumber}: ${game.white} vs ${game.black}`)
                }
              >
                Open in Tab
              </Button>
            )}
          </Group>
        </Group>
      </Box>

      {/* Main Content Area */}
      <Box style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Interactive Board with EvalBar */}
        <Box
          ref={boardContainerRef}
          p="md"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {/* Top Player Bar */}
          <PlayerBar
            details={topDetails}
            isTurn={turnColor === topPlayer && isOngoing}
            isBlack={topPlayer === "black"}
            maxWidth={boardSize + 35}
            onOpenFide={(name) => setFideModalPlayer(name)}
          />

          {/* Board + EvalBar Row */}
          <Group
            my="xs"
            gap="xs"
            align="center"
            style={{
              flexWrap: "nowrap",
              justifyContent: "center",
            }}
          >
            {/* Vertical EvalBar */}
            <Box
              h={boardSize}
              style={{
                width: 25,
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <EvalBar score={displayScore} orientation={orientation} />
            </Box>

            {/* Chessboard */}
            <Box
              style={{
                width: boardSize,
                height: boardSize,
                position: "relative",
                borderRadius: "4px",
                overflow: "hidden",
              }}
            >
              <Chessground
                fen={currentNode.fen}
                orientation={orientation}
                turnColor={turnColor}
                movable={{ free: false }}
                draggable={{ enabled: false }}
                drawable={{
                  enabled: true,
                  visible: true,
                  autoShapes: engineShapes,
                }}
              />
            </Box>
          </Group>

          {/* Bottom Player Bar */}
          <PlayerBar
            details={bottomDetails}
            isTurn={turnColor === bottomPlayer && isOngoing}
            isBlack={bottomPlayer === "black"}
            maxWidth={boardSize + 35}
            onOpenFide={(name) => setFideModalPlayer(name)}
          />
        </Box>

        {/* Right: Notation & Live Engine Analysis */}
        <Box
          w={{ base: 280, md: 360 }}
          style={{
            borderLeft: "1px solid var(--mantine-color-default-border)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            backgroundColor: "var(--mantine-color-body)",
          }}
        >
          {/* Navigation Controls & Live Follow Indicator */}
          <Group justify="space-between" align="center" p="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
            <Group gap={4}>
              <ActionIcon variant="default" size="sm" onClick={handleStart} title="Start">
                <IconPlayerSkipBack size={16} />
              </ActionIcon>
              <ActionIcon variant="default" size="sm" onClick={handlePrev} title="Previous move">
                <IconPlayerTrackPrev size={16} />
              </ActionIcon>
              <ActionIcon variant="default" size="sm" onClick={handleNext} title="Next move">
                <IconPlayerTrackNext size={16} />
              </ActionIcon>
              <ActionIcon variant="default" size="sm" onClick={handleEnd} title="Latest / Live move">
                <IconPlayerSkipForward size={16} />
              </ActionIcon>
            </Group>

            {isAtLatest ? (
              <Badge size="xs" color="teal" variant="light">
                <Group gap={4} wrap="nowrap">
                  <span className={classes.pulseDotGreen} style={{ width: 6, height: 6 }} />
                  LIVE
                </Group>
              </Badge>
            ) : (
              <Button
                size="compact-xs"
                variant="light"
                color="teal"
                leftSection={<span className={classes.pulseDotGreen} style={{ width: 6, height: 6 }} />}
                onClick={handleEnd}
              >
                Go to Live
              </Button>
            )}
          </Group>

          {/* In-Place Local Engine Panel (Full Analysis) */}
          {engineMode === "full" && (
            <InPlaceEnginePanel
              rootFen={rootNode.fen}
              moves={variationMoves}
              halfMoves={currentNode.halfMoves}
              onOpenSettings={() => setSettingsModalOpen(true)}
            />
          )}

          {/* Eval Bar Only Panel (Spoiler-free indicator) */}
          {engineMode === "eval-bar" && (
            <EvalBarOnlyPanel
              engineName={firstLoadedEngine?.name || "Stockfish"}
              depth={evalDepth}
              rootFen={rootNode.fen}
              moves={variationMoves}
              onOpenSettings={() => setSettingsModalOpen(true)}
            />
          )}

          {/* Move Notation List */}
          <ScrollArea style={{ flex: 1 }} p="xs">
            <MoveTable
              moves={movesList}
              currentPly={position.length}
              onSelectMove={(path) => store.getState().goToMove(path)}
            />
          </ScrollArea>
        </Box>
      </Box>

      {/* Engine Listener (Always mounted to respond to enabled changes and stop cleanly) */}
      <EvalListener />

      {/* Engine Settings Modal */}
      <BroadcastEngineSettingsModal
        opened={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        engineMode={engineMode}
        onModeChange={handleModeChange}
        evalDepth={evalDepth}
        onEvalDepthChange={handleEvalDepthChange}
        engine={firstLoadedEngine}
        settings={settings}
        setSettings={setSettings}
      />

      {/* FIDE Player Info Modal */}
      <FideInfo
        opened={!!fideModalPlayer}
        setOpened={(opened) => !opened && setFideModalPlayer(null)}
        name={fideModalPlayer || ""}
      />
    </Box>
  );
}

function useLiveGameClocks({
  whiteClk,
  blackClk,
  turn,
  isOngoing,
}: {
  whiteClk?: string;
  blackClk?: string;
  turn: "white" | "black";
  isOngoing: boolean;
}) {
  const parseClock = (clk?: string): number | null => {
    if (!clk) return null;
    const parts = clk.split(":").map((p) => parseFloat(p));
    if (parts.some((p) => isNaN(p))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return null;
  };

  const initialWhite = parseClock(whiteClk);
  const initialBlack = parseClock(blackClk);

  const [clocks, setClocks] = useState<{ white: number | null; black: number | null }>({
    white: initialWhite,
    black: initialBlack,
  });

  const lastSyncRef = useRef<{ time: number; white: number | null; black: number | null }>({
    time: Date.now(),
    white: initialWhite,
    black: initialBlack,
  });

  // When live poll updates the clocks, update base
  useEffect(() => {
    const w = parseClock(whiteClk);
    const b = parseClock(blackClk);
    lastSyncRef.current = {
      time: Date.now(),
      white: w,
      black: b,
    };
    setClocks({ white: w, black: b });
  }, [whiteClk, blackClk]);

  // Tick down in real time for the active turn
  useEffect(() => {
    if (!isOngoing) return;

    const timer = setInterval(() => {
      const elapsed = (Date.now() - lastSyncRef.current.time) / 1000;
      const baseW = lastSyncRef.current.white;
      const baseB = lastSyncRef.current.black;

      setClocks({
        white: baseW !== null ? Math.max(0, turn === "white" ? baseW - elapsed : baseW) : null,
        black: baseB !== null ? Math.max(0, turn === "black" ? baseB - elapsed : baseB) : null,
      });
    }, 250);

    return () => clearInterval(timer);
  }, [turn, isOngoing]);

  const format = (seconds: number | null) => {
    if (seconds === null) return undefined;
    const s = Math.max(0, seconds);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 3600 % 60);

    let res = `${minutes.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
    if (hours > 0) {
      res = `${hours}:${res}`;
    }
    if (hours === 0 && minutes === 0 && s < 30) {
      const tenth = Math.floor((s % 1) * 10);
      res = `${sec.toString().padStart(2, "0")}.${tenth}`;
    }
    return res;
  };

  return {
    formattedWhite: format(clocks.white),
    formattedBlack: format(clocks.black),
  };
}

function usePlayerPhoto(name?: string, fideId?: string) {
  const query = fideId || (name && name !== "White" && name !== "Black" ? name : undefined);
  const { data } = useSWR(
    query ? `fide-photo-${query}` : null,
    async () => {
      try {
        const p = await getFidePlayer(query!);
        return p?.photo?.small || p?.photo?.medium || null;
      } catch {
        return null;
      }
    },
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 3600000 * 24, // 24 hours cache
    },
  );
  return data ?? null;
}

function PlayerBar({
  details,
  isTurn,
  isBlack,
  maxWidth,
  onOpenFide,
}: {
  details: {
    name: string;
    title?: string;
    elo?: string;
    team?: string;
    clk?: string;
    fideId?: string;
  };
  isTurn: boolean;
  isBlack: boolean;
  maxWidth: number;
  onOpenFide?: (name: string) => void;
}) {
  const photoUrl = usePlayerPhoto(details.name, details.fideId);
  const initials = details.name
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

  return (
    <Group
      justify="space-between"
      align="center"
      className={classes.playerBar}
      w="100%"
      style={{
        maxWidth,
        border: isTurn ? "1px solid var(--mantine-color-blue-filled)" : undefined,
      }}
    >
      <Group gap="xs" wrap="nowrap" style={{ overflow: "hidden" }}>
        {/* Player Avatar with piece color badge indicator */}
        <Tooltip label={`View ${details.name} profile`} openDelay={600}>
          <Box
            style={{
              position: "relative",
              cursor: onOpenFide ? "pointer" : "default",
              display: "inline-flex",
              alignItems: "center",
              flexShrink: 0,
            }}
            onClick={() => onOpenFide?.(details.name)}
          >
            <Avatar
              src={photoUrl}
              size={30}
              radius="xl"
              alt={details.name}
              styles={{
                root: {
                  border: isBlack
                    ? "1px solid var(--mantine-color-gray-8)"
                    : "1px solid var(--mantine-color-gray-5)",
                  backgroundColor: isBlack ? "#212529" : "#e9ecef",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                },
                placeholder: {
                  color: isBlack ? "#f8f9fa" : "#111827",
                  backgroundColor: isBlack ? "#212529" : "#e9ecef",
                  fontWeight: 700,
                  fontSize: 11,
                },
              }}
            >
              <span
                style={{
                  color: isBlack ? "#f8f9fa" : "#111827",
                  fontWeight: 700,
                  fontSize: 11,
                  userSelect: "none",
                }}
              >
                {initials || (isBlack ? "B" : "W")}
              </span>
            </Avatar>
            <Box
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: isBlack ? "#111" : "#fff",
                border: isBlack ? "1.5px solid #666" : "1.5px solid #222",
                boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
              }}
            />
          </Box>
        </Tooltip>

        {details.title && (
          <Badge size="xs" color="orange" variant="filled">
            {details.title}
          </Badge>
        )}
        <Text
          size="sm"
          fw={600}
          lineClamp={1}
          style={{ cursor: onOpenFide ? "pointer" : "default" }}
          onClick={() => onOpenFide?.(details.name)}
        >
          {details.name}
        </Text>
        {details.elo && (
          <Text size="xs" c="dimmed">
            ({details.elo})
          </Text>
        )}
        {details.team && (
          <Badge size="xs" variant="outline" color="gray">
            {details.team}
          </Badge>
        )}
      </Group>

      {details.clk && (
        <span className={classes.clockBadge}>{details.clk}</span>
      )}
    </Group>
  );
}

function MoveTable({
  moves,
  currentPly,
  onSelectMove,
}: {
  moves: { ply: number; san: string; path: number[] }[];
  currentPly: number;
  onSelectMove: (path: number[]) => void;
}) {
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);

  // Auto-scroll to current ply when move updates
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentPly]);

  // Group into pairs (white, black)
  const rows: { moveNum: number; white?: { san: string; path: number[]; ply: number }; black?: { san: string; path: number[]; ply: number } }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    rows.push({
      moveNum,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <Table verticalSpacing={2} horizontalSpacing={4} style={{ fontSize: "0.85rem" }}>
      <Table.Tbody>
        {rows.map((row) => {
          const isActiveRow =
            row.white?.ply === currentPly || row.black?.ply === currentPly;
          return (
            <Table.Tr
              key={row.moveNum}
              ref={isActiveRow ? activeRowRef : undefined}
            >
              <Table.Td style={{ width: 36, color: "var(--mantine-color-dimmed)" }}>
                {row.moveNum}.
              </Table.Td>
              <Table.Td
                onClick={() => row.white && onSelectMove(row.white.path)}
                style={{
                  cursor: "pointer",
                  borderRadius: "3px",
                  fontWeight: row.white?.ply === currentPly ? 700 : 400,
                  backgroundColor:
                    row.white?.ply === currentPly
                      ? "var(--mantine-color-blue-light)"
                      : undefined,
                }}
              >
                {row.white?.san}
              </Table.Td>
              <Table.Td
                onClick={() => row.black && onSelectMove(row.black.path)}
                style={{
                  cursor: "pointer",
                  borderRadius: "3px",
                  fontWeight: row.black?.ply === currentPly ? 700 : 400,
                  backgroundColor:
                    row.black?.ply === currentPly
                      ? "var(--mantine-color-blue-light)"
                      : undefined,
                }}
              >
                {row.black?.san}
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function formatPvMoves(sanMoves: string[], uciMoves: string[], halfMoves: number): string {
  const moves = sanMoves && sanMoves.length > 0 ? sanMoves : uciMoves;
  if (!moves || moves.length === 0) return "";
  const parts: string[] = [];
  let currentHalf = halfMoves;
  for (let i = 0; i < Math.min(moves.length, 10); i++) {
    const moveNum = Math.floor(currentHalf / 2) + 1;
    const isBlack = currentHalf % 2 === 1;
    if (i === 0) {
      parts.push(isBlack ? `${moveNum}... ${moves[i]}` : `${moveNum}. ${moves[i]}`);
    } else if (!isBlack) {
      parts.push(`${moveNum}. ${moves[i]}`);
    } else {
      parts.push(moves[i]);
    }
    currentHalf++;
  }
  return parts.join(" ");
}

function InPlaceEnginePanel({
  rootFen,
  moves,
  halfMoves,
  onOpenSettings,
}: {
  rootFen: string;
  moves: string[];
  halfMoves: number;
  onOpenSettings?: () => void;
}) {
  const [engines] = useAtom(enginesAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const tabId = activeTab || "broadcast";
  const firstLoadedEngine = engines?.find((e) => e.loaded);

  const [settings, setSettings] = useAtom(
    tabEngineSettingsFamily({
      engineId: firstLoadedEngine?.id || "",
      defaultSettings: firstLoadedEngine?.settings ?? undefined,
      defaultGo: firstLoadedEngine?.go ?? undefined,
      tab: tabId,
    }),
  );

  const engineMoves = useAtomValue(
    engineMovesFamily({
      engine: firstLoadedEngine?.id || "",
      tab: tabId,
    }),
  );

  const progress = useAtomValue(
    engineProgressFamily({
      engine: firstLoadedEngine?.id || "",
      tab: tabId,
    }),
  );

  // Retrieve evaluated lines under the exact searching key used by EvalListener
  const currentLines: BestMoves[] =
    engineMoves.get(`${rootFen}:${moves.join(",")}`) ||
    engineMoves.get(`${rootFen}:`) ||
    [];

  // MultiPV lines customization (1, 2, 3 lines)
  const currentMultiPv =
    settings.settings?.find((s) => s.name === "MultiPV")?.value ?? 1;

  const handleMultiPvChange = (val: string) => {
    const lines = parseInt(val, 10);
    const updatedSettings = settings.settings?.map((s) =>
      s.name === "MultiPV" ? { ...s, value: lines } : s,
    ) || [{ name: "MultiPV", value: lines }];
    if (!updatedSettings.some((s) => s.name === "MultiPV")) {
      updatedSettings.push({ name: "MultiPV", value: lines });
    }
    setSettings((prev) => ({ ...prev, settings: updatedSettings }));
  };

  if (!firstLoadedEngine) {
    return (
      <Box p="xs" bg="dark.7" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Text size="xs" c="orange">
          No engine loaded. Load Stockfish in the Engines tab.
        </Text>
      </Box>
    );
  }

  const top = currentLines[0];

  return (
    <Box p="xs" bg="dark.8" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
      {/* Engine header */}
      <Group justify="space-between" align="center" mb={6}>
        <Group gap={6}>
          <IconCpu size={15} color="var(--mantine-color-teal-5)" />
          <Text size="xs" fw={700}>
            {firstLoadedEngine.name}
          </Text>
        </Group>

        <Group gap={6}>
          {top?.depth !== undefined && (
            <Badge size="xs" variant="light" color="gray">
              d: {top.depth}
            </Badge>
          )}
          {top?.nps !== undefined && (
            <Text size="xs" c="dimmed">
              {formatNodes(top.nps, 1)}n/s
            </Text>
          )}
          {onOpenSettings && (
            <Tooltip label="Engine Settings (Depth, Cores, Memory)">
              <ActionIcon variant="subtle" size="xs" onClick={onOpenSettings}>
                <IconSettings size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>

      {/* Controls & customization: MultiPV line selector */}
      <Group justify="space-between" align="center" mb={6}>
        <Text size="xs" c="dimmed">Lines (MultiPV):</Text>
        <SegmentedControl
          size="xs"
          value={currentMultiPv.toString()}
          onChange={handleMultiPvChange}
          data={[
            { label: "1", value: "1" },
            { label: "2", value: "2" },
            { label: "3", value: "3" },
          ]}
        />
      </Group>

      {/* Progress bar */}
      <Progress
        value={progress}
        size="xs"
        animated={progress < 100 && settings.enabled}
        color="teal"
        mb={6}
      />

      {/* Candidate lines */}
      {currentLines.length > 0 ? (
        <Stack gap={6}>
          {currentLines.slice(0, Number(currentMultiPv)).map((line, idx) => (
            <Group key={idx} justify="space-between" align="center" wrap="nowrap" gap="xs">
              <ScoreBubble size="sm" score={line.score} />
              <Text size="xs" ff="monospace" lineClamp={2} style={{ flex: 1, lineHeight: 1.3 }}>
                {formatPvMoves(line.sanMoves, line.uciMoves, halfMoves)}
              </Text>
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="xs" c="dimmed" ta="center" py={4}>
          Calculating evaluation...
        </Text>
      )}
    </Box>
  );
}

function EvalBarOnlyPanel({
  engineName,
  depth,
  rootFen,
  moves,
  onOpenSettings,
}: {
  engineName: string;
  depth: number;
  rootFen: string;
  moves: string[];
  onOpenSettings?: () => void;
}) {
  const [engines] = useAtom(enginesAtom);
  const activeTab = useAtomValue(activeTabAtom);
  const tabId = activeTab || "broadcast";
  const firstLoadedEngine = engines?.find((e) => e.loaded);

  const engineMoves = useAtomValue(
    engineMovesFamily({
      engine: firstLoadedEngine?.id || "",
      tab: tabId,
    }),
  );

  const progress = useAtomValue(
    engineProgressFamily({
      engine: firstLoadedEngine?.id || "",
      tab: tabId,
    }),
  );

  const currentLines =
    engineMoves.get(`${rootFen}:${moves.join(",")}`) ||
    engineMoves.get(`${rootFen}:`) ||
    [];
  const top = currentLines[0];
  const isCalculating = progress < 100;

  return (
    <Box p="xs" bg="dark.8" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
      <Group justify="space-between" align="center" mb={4}>
        <Group gap={6}>
          <IconCpu size={14} color="var(--mantine-color-teal-5)" />
          <Text size="xs" fw={600}>
            Eval Bar Only
          </Text>
          <Badge size="xs" variant="light" color="teal">
            d{depth} · 1 line
          </Badge>
        </Group>

        <Group gap={6}>
          {top?.depth !== undefined ? (
            <Text size="xs" c="dimmed">
              depth {top.depth}/{depth}
            </Text>
          ) : (
            <Text size="xs" c="dimmed">
              {engineName}
            </Text>
          )}
          {onOpenSettings && (
            <Tooltip label="Engine Settings (Depth, Cores, Memory)">
              <ActionIcon variant="subtle" size="xs" onClick={onOpenSettings}>
                <IconSettings size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>

      <Progress
        value={progress}
        size="xs"
        animated={isCalculating}
        color="teal"
      />
    </Box>
  );
}

