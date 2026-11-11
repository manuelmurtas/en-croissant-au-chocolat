import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color } from "@lichess-org/chessground/types";
import { isNormal, makeSquare, parseSquare, type NormalMove, parseUci, type Square } from "chessops";
import { makeFen } from "chessops/fen";
import { match } from "ts-pattern";
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
  IconPictureInPicture,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconSettings,
  IconZoomCheck,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import useSWR from "swr/immutable";
import { PIP_CHANNEL_NAME, PIP_STORAGE_KEY, type PipState } from "./PipGameView";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { commands, type BestMoves, type Score } from "@/bindings";
import { Chessground } from "@/chessground/Chessground";
import AnnotationHint, { AnnotationBadge } from "@/components/boards/AnnotationHint";
import EvalBar from "@/components/boards/EvalBar";
import EvalListener from "@/components/boards/EvalListener";
import { TreeStateContext, TreeStateProvider } from "@/components/common/TreeStateContext";
import FideInfo from "@/components/databases/FideInfo";
import ScoreBubble from "@/components/panels/analysis/ScoreBubble";
import { useProgress } from "@/hooks/useProgress";
import {
  activeTabAtom,
  type BroadcastEngineMode,
  broadcastEngineModeAtom,
  broadcastEvalDepthAtom,
  enableAllAtom,
  engineMovesFamily,
  engineProgressFamily,
  enginesAtom,
  tabEngineSettingsFamily,
} from "@/state/atoms";
import { keyMapAtom } from "@/state/keybinds";
import { type Annotation, isBasicAnnotation } from "@/utils/annotation";
import { getMainLine, getVariationLine, parsePGN } from "@/utils/chess";
import { positionFromFen, swapMove } from "@/utils/chessops";
import { type LocalEngine, stopEngine } from "@/utils/engines";
import { formatNodes } from "@/utils/format";
import { classifyMove, getReviewColor } from "@/utils/gameReview";
import { getFidePlayer } from "@/utils/lichess/api";
import type { BroadcastGameSummary } from "@/utils/lichess/broadcast";
import { formatScore, INITIAL_SCORE } from "@/utils/score";
import { playSound } from "@/utils/sound";
import type { TreeNode, TreeState } from "@/utils/treeReducer";
import BroadcastEngineSettingsModal from "./BroadcastEngineSettingsModal";
import classes from "./Broadcasts.module.css";

// MultiPV line colors: 1st line green, 2nd line yellow, 3rd line red, 4th+ blue
export const LINE_ARROW_COLORS = ["green", "yellow", "red", "blue"];
export const LINE_HEX_COLORS = ["#15781B", "#e68f00", "#882020", "#003088"];

// Global persistent review evaluation cache with bounded size (prevents unbounded memory growth)
const MAX_REVIEW_CACHE_SIZE = 2500;
const reviewScoreCache = new Map<string, { score: Score; annotations: Annotation[] }>();

function setCachedReviewScore(fen: string, data: { score: Score; annotations: Annotation[] }) {
  if (reviewScoreCache.size >= MAX_REVIEW_CACHE_SIZE) {
    const oldest = reviewScoreCache.keys().next().value;
    if (oldest) reviewScoreCache.delete(oldest);
  }
  reviewScoreCache.set(fen, data);
}

function countUnanalyzedMoves(rootNode: TreeNode): number {
  let count = 0;
  let curr: TreeNode | null = rootNode;
  while (curr && curr.children && curr.children.length > 0) {
    const next: TreeNode | undefined = curr.children[0];
    if (!next) break;
    if (!next.score && !reviewScoreCache.has(next.fen)) {
      count++;
    }
    curr = next;
  }
  return count;
}

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
  tourName: _tourName,
  onOpenAnalysisTab,
}: LiveGameViewProps) {
  const [initialTree, setInitialTree] = useState<TreeState | null>(null);

  // Parse initial PGN when game.id changes and set position directly to the end of the mainline
  useEffect(() => {
    let cancelled = false;
    setInitialTree(null);
    parsePGN(game.pgn).then((tree) => {
      if (!cancelled) {
        // Hydrate from reviewScoreCache to avoid re-evaluating known positions
        let curr: TreeNode | null = tree.root;
        while (curr) {
          const cached = reviewScoreCache.get(curr.fen);
          if (cached) {
            curr.score = cached.score;
            if (cached.annotations?.length > 0) {
              curr.annotations = [...cached.annotations];
            }
          }
          curr = curr.children[0] || null;
        }
        tree.position = getEndPosition(tree.root);
        setInitialTree(tree);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        tourName={_tourName}
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

function mergeTreeScores(newRoot: TreeNode, oldRoot: TreeNode) {
  const oldScoreMap = new Map<string, { score: Score | null; annotations: Annotation[] }>();
  let curr: TreeNode | null = oldRoot;
  while (curr) {
    if (curr.score || (curr.annotations && curr.annotations.length > 0)) {
      oldScoreMap.set(curr.fen, { score: curr.score, annotations: curr.annotations });
    }
    curr = curr.children[0] || null;
  }

  let newCurr: TreeNode | null = newRoot;
  while (newCurr) {
    const existing = oldScoreMap.get(newCurr.fen) || reviewScoreCache.get(newCurr.fen);
    if (existing) {
      if (!newCurr.score && existing.score) {
        newCurr.score = existing.score;
      }
      if (existing.annotations && existing.annotations.length > 0) {
        for (const a of existing.annotations) {
          if (!newCurr.annotations.includes(a)) {
            newCurr.annotations.push(a);
          }
        }
      }
    }
    newCurr = newCurr.children[0] || null;
  }
}

export type LiveMoveItem = {
  ply: number;
  san: string;
  path: number[];
  score: Score | null;
  annotation: Annotation | null;
  fen: string;
  destSquare?: Square;
};

function LiveGameContent({
  game,
  tourName: _tourName,
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

      mergeTreeScores(newTree.root, storeState.root);

      store.setState({
        root: newTree.root,
        headers: newTree.headers,
        position: wasAtLatest ? newEndPos : currentPos,
      });
    });
  }, [game.pgn, store]);

  const variationMoves = useStore(
    store,
    useShallow((s) => (s.root ? getVariationLine(s.root, s.position) : [])),
  );

  const [, setActiveTab] = useAtom(activeTabAtom);
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

  // Synchronize settings from saved engine when loaded
  useEffect(() => {
    if (firstLoadedEngine?.settings && settings.synced) {
      setSettings((prev) => ({
        ...prev,
        go: firstLoadedEngine.go || prev.go,
        settings: firstLoadedEngine.settings || prev.settings,
      }));
    }
  }, [firstLoadedEngine?.id, firstLoadedEngine?.settings, firstLoadedEngine?.go, settings.synced, setSettings]);

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

  // Cleanup engines on unmount
  useEffect(() => {
    return () => {
      enableAll(false);
      stopAllEngines();
    };
  }, [enableAll, stopAllEngines]);

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

  // Clocks are rendered isolated in PlayerBar via LiveClockBadge to avoid re-rendering LiveGameContent

  // Navigation handlers
  const handleStart = useCallback(() => store.getState().goToStart(), [store]);
  const handlePrev = useCallback(() => store.getState().goToPrevious(), [store]);
  const handleNext = useCallback(() => store.getState().goToNext(), [store]);
  const handleEnd = useCallback(() => store.getState().goToEnd(), [store]);

  // Flip board
  const toggleOrientation = useCallback(() => {
    setOrientation((o) => (o === "white" ? "black" : "white"));
  }, []);

  const [fideModalPlayer, setFideModalPlayer] = useState<string | null>(null);

  // Keyboard navigation & software keybindings
  const keyMap = useAtomValue(keyMapAtom);

  const prevKey = keyMap.PREVIOUS_MOVE?.keys || "arrowleft";
  const nextKey = keyMap.NEXT_MOVE?.keys || "arrowright";
  const startKey = keyMap.GO_TO_START?.keys || "shift+arrowup";
  const endKey = keyMap.GO_TO_END?.keys || "shift+down";
  const flipKey = keyMap.SWAP_ORIENTATION?.keys || "f";
  const evalKey = keyMap.TOGGLE_EVAL_BAR?.keys || "z";

  const lastNavTimeRef = useRef(0);
  const handlePrevThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastNavTimeRef.current < 60) return;
    lastNavTimeRef.current = now;
    handlePrev();
  }, [handlePrev]);

  const handleNextThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastNavTimeRef.current < 60) return;
    lastNavTimeRef.current = now;
    handleNext();
  }, [handleNext]);

  useHotkeys(
    prevKey,
    (e) => {
      e.preventDefault();
      if (!e.repeat) handlePrevThrottled();
    },
    { preventDefault: true, enabled: !settingsModalOpen && !fideModalPlayer }, [handlePrevThrottled, settingsModalOpen, fideModalPlayer],
  );

  useHotkeys(
    nextKey,
    (e) => {
      e.preventDefault();
      if (!e.repeat) handleNextThrottled();
    },
    { preventDefault: true, enabled: !settingsModalOpen && !fideModalPlayer }, [handleNextThrottled, settingsModalOpen, fideModalPlayer],
  );

  useHotkeys(
    startKey,
    (e) => {
      e.preventDefault();
      if (!e.repeat) handleStart();
    },
    { preventDefault: true, enabled: !settingsModalOpen && !fideModalPlayer }, [handleStart, settingsModalOpen, fideModalPlayer],
  );

  useHotkeys(
    endKey,
    (e) => {
      e.preventDefault();
      if (!e.repeat) handleEnd();
    },
    { preventDefault: true, enabled: !settingsModalOpen && !fideModalPlayer }, [handleEnd, settingsModalOpen, fideModalPlayer],
  );

  useHotkeys(
    flipKey,
    (e) => {
      e.preventDefault();
      if (!e.repeat) toggleOrientation();
    },
    { preventDefault: true, enabled: !settingsModalOpen && !fideModalPlayer }, [toggleOrientation, settingsModalOpen, fideModalPlayer],
  );

  useHotkeys(
    evalKey,
    (e) => {
      e.preventDefault();
      if (!e.repeat) {
        handleModeChange(
          engineMode === "off"
            ? "eval-bar"
            : engineMode === "eval-bar"
              ? "full"
              : "off",
        );
      }
    },
    { preventDefault: true, enabled: !settingsModalOpen && !fideModalPlayer }, [engineMode, handleModeChange, settingsModalOpen, fideModalPlayer],
  );

  useHotkeys(
    keyMap.GO_TO_BRANCH_START?.keys || "arrowup",
    (e) => {
      e.preventDefault();
      if (!e.repeat) store.getState().goToBranchStart();
    },
    { preventDefault: true },
    [store],
  );

  useHotkeys(
    keyMap.GO_TO_BRANCH_END?.keys || "arrowdown",
    (e) => {
      e.preventDefault();
      if (!e.repeat) store.getState().goToBranchEnd();
    },
    { preventDefault: true },
    [store],
  );

  useHotkeys(
    keyMap.NEXT_BRANCH?.keys || "c",
    (e) => {
      e.preventDefault();
      if (!e.repeat) store.getState().nextBranch();
    },
    { preventDefault: true },
    [store],
  );

  useHotkeys(
    keyMap.PREVIOUS_BRANCH?.keys || "x",
    (e) => {
      e.preventDefault();
      if (!e.repeat) store.getState().previousBranch();
    },
    { preventDefault: true },
    [store],
  );

  useHotkeys(
    keyMap.NEXT_BRANCHING?.keys || "shift+arrowright",
    (e) => {
      e.preventDefault();
      if (!e.repeat) store.getState().nextBranching();
    },
    { preventDefault: true },
    [store],
  );

  useHotkeys(
    keyMap.PREVIOUS_BRANCHING?.keys || "shift+arrowleft",
    (e) => {
      e.preventDefault();
      if (!e.repeat) store.getState().previousBranching();
    },
    { preventDefault: true },
    [store],
  );

  // Copy PGN
  const copyPgn = () => {
    navigator.clipboard.writeText(game.pgn);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Engine arrows on board (MultiPV: 1st line green, 2nd yellow, 3rd red)
  const engineMoves = useAtomValue(
    engineMovesFamily({
      engine: firstLoadedEngine?.id || "",
      tab: "broadcast",
    }),
  );

  const currentMultiPv = Number(
    settings.settings?.find((s) => s.name === "MultiPV")?.value ?? 1,
  );

  const currentLines: BestMoves[] = useMemo(() => {
    if (!engineMoves) return [];
    const direct =
      engineMoves.get(`${rootNode.fen}:${variationMoves.join(",")}`) ||
      engineMoves.get(`${rootNode.fen}:`);
    if (direct && direct.length > 0) return direct;

    const [p] = positionFromFen(rootNode.fen);
    if (p) {
      for (const m of variationMoves) {
        const parsed = parseUci(m);
        if (parsed) p.play(parsed);
      }
      const setupFen = makeFen(p.toSetup());
      const transposed = engineMoves.get(`${swapMove(setupFen)}:`);
      if (transposed && transposed.length > 0) return transposed;
    }
    return [];
  }, [engineMoves, rootNode.fen, variationMoves]);

  const engineShapes = useMemo((): DrawShape[] => {
    if (engineMode !== "full" || !currentLines || currentLines.length === 0) return [];

    const linesToDisplay = currentLines.slice(0, currentMultiPv);
    const forwardShapes: DrawShape[] = [];

    for (let idx = 0; idx < linesToDisplay.length; idx++) {
      const line = linesToDisplay[idx];
      const uci = line.uciMoves?.[0];
      if (!uci) continue;

      const m = parseUci(uci) as NormalMove | undefined;
      if (!m) continue;

      const from = makeSquare(m.from);
      const to = makeSquare(m.to);
      if (from && to) {
        if (!forwardShapes.some((s) => s.orig === from && s.dest === to)) {
          forwardShapes.push({
            orig: from,
            dest: to,
            brush: LINE_ARROW_COLORS[idx] || "blue",
          });
        }
      }
    }

    // Reverse array so top line (idx 0, green) is rendered last and thus on top in SVG stacking order
    return forwardShapes.reverse();
  }, [engineMode, currentLines, currentMultiPv]);

  // Live Game Review: analyze moves sequentially at Depth 20 without re-calculating already analyzed moves
  const [isReviewing, setIsReviewing] = useState(false);
  const isReviewingRef = useRef(false);
  const analysisId = useMemo(() => `live_review_${game.id}`, [game.id]);
  const { progress: reviewProgress } = useProgress(analysisId);

  const runLiveGameReview = useCallback(async (forceAll = false) => {
    if (!firstLoadedEngine || firstLoadedEngine.type !== "local" || !firstLoadedEngine.path) return;
    if (isReviewingRef.current) return;

    const allMoves = getMainLine(rootNode);
    if (allMoves.length === 0) return;

    const nodes: TreeNode[] = [];
    let curr: TreeNode | null = rootNode;
    while (curr && curr.children && curr.children.length > 0) {
      const next: TreeNode | undefined = curr.children[0];
      if (!next) break;
      if (!next.score && reviewScoreCache.has(next.fen)) {
        const cached = reviewScoreCache.get(next.fen)!;
        next.score = cached.score;
        if (cached.annotations?.length > 0) {
          next.annotations = [...cached.annotations];
        }
      }
      nodes.push(next);
      curr = next;
    }

    let firstUnanalyzedIndex = 0;
    if (!forceAll) {
      while (
        firstUnanalyzedIndex < nodes.length &&
        nodes[firstUnanalyzedIndex].score !== null
      ) {
        firstUnanalyzedIndex++;
      }
    }

    // If all moves are already evaluated at depth 20, do not recalculate!
    if (firstUnanalyzedIndex >= nodes.length) {
      return;
    }

    const startFen = firstUnanalyzedIndex === 0 ? rootNode.fen : nodes[firstUnanalyzedIndex - 1].fen;
    const batchMoves = allMoves.slice(firstUnanalyzedIndex);
    if (batchMoves.length === 0) return;

    isReviewingRef.current = true;
    setIsReviewing(true);

    try {
      const res = await commands.analyzeGame(
        analysisId,
        firstLoadedEngine.path,
        { t: "Depth", c: 20 },
        {
          annotateNovelties: false,
          fen: startFen,
          referenceDb: null,
          reversed: false,
          moves: batchMoves,
        },
        (firstLoadedEngine.settings ?? []).map((s) => ({
          ...s,
          value: s.value?.toString() ?? "",
        })),
      );

      if (res.status === "ok") {
        for (let j = 1; j <= batchMoves.length; j++) {
          const targetNodeIndex = firstUnanalyzedIndex + j - 1;
          const targetNode = nodes[targetNodeIndex];
          const analysisItem = res.data[j];
          if (targetNode && analysisItem?.best?.length > 0) {
            const score = analysisItem.best[0].score;
            targetNode.score = score;
            setCachedReviewScore(targetNode.fen, {
              score,
              annotations: targetNode.annotations || [],
            });
          }
        }

        if (firstUnanalyzedIndex === 0 && res.data[0]?.best?.length > 0) {
          rootNode.score = res.data[0].best[0].score;
          setCachedReviewScore(rootNode.fen, {
            score: rootNode.score,
            annotations: rootNode.annotations || [],
          });
        }

        store.setState({ root: { ...rootNode } });
      }
    } catch (err) {
      console.warn("Live game review error:", err);
    } finally {
      isReviewingRef.current = false;
      setIsReviewing(false);
    }
  }, [firstLoadedEngine, rootNode, analysisId, store]);

  // Cancel any in-flight live review on unmount or game change
  useEffect(() => {
    return () => {
      commands.cancelAnalysis(analysisId).catch(() => {});
      isReviewingRef.current = false;
    };
  }, [analysisId]);

  // Automatically trigger review only when moves actually need evaluation (never on harmless refreshes)
  useEffect(() => {
    if (
      engineMode !== "off" &&
      firstLoadedEngine &&
      firstLoadedEngine.type === "local" &&
      !isReviewingRef.current
    ) {
      const unanalyzedCount = countUnanalyzedMoves(rootNode);
      if (unanalyzedCount > 0) {
        const timer = setTimeout(() => {
          runLiveGameReview();
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [engineMode, firstLoadedEngine, rootNode, runLiveGameReview]);

  // Book plies detection: check mainline FENs against ECO openings database
  const [bookPlies, setBookPlies] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const fens: string[] = [];
    let curr: TreeNode | null = rootNode;
    while (curr && curr.children && curr.children.length > 0) {
      const next: TreeNode | undefined = curr.children[0];
      if (!next) break;
      fens.push(next.fen);
      curr = next;
    }

    if (fens.length === 0) {
      setBookPlies(0);
      return;
    }

    const pliesToCheck = fens.slice(0, 30);
    Promise.all(pliesToCheck.map((f) => commands.getOpeningFromFen(f)))
      .then((results) => {
        if (cancelled) return;
        let lastBookPly = 0;
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === "ok") {
            lastBookPly = i + 1;
          }
        }
        if (lastBookPly === 0 && (game.eco || game.opening)) {
          lastBookPly = Math.min(8, fens.length);
        }
        setBookPlies(lastBookPly);
      })
      .catch(() => {
        if (!cancelled && (game.eco || game.opening)) {
          setBookPlies(Math.min(8, fens.length));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rootNode, game.eco, game.opening]);

  const effectiveBookPlies = useMemo(() => {
    if (bookPlies > 0) return bookPlies;
    if (game.eco || game.opening) return 6;
    return 0;
  }, [bookPlies, game.eco, game.opening]);

  // Extract flat main line moves for move list with live evaluations and review annotations
  const movesList: LiveMoveItem[] = useMemo(() => {
    const list: LiveMoveItem[] = [];
    let current: TreeNode | null = rootNode;
    const nodes: TreeNode[] = [];

    while (current && current.children && current.children.length > 0) {
      const nextNode: TreeNode | undefined = current.children[0];
      if (!nextNode) break;
      nodes.push(nextNode);
      current = nextNode;
    }

    let prevScore: Score = rootNode.score ?? INITIAL_SCORE;
    let prevOpponentWinChanceDiff = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const movePly = i + 1;
      const movingColor: Color = movePly % 2 === 1 ? "white" : "black";

      let moveScore = node.score;
      if (!moveScore && reviewScoreCache.has(node.fen)) {
        moveScore = reviewScoreCache.get(node.fen)!.score;
        node.score = moveScore;
      }
      if (!moveScore && i === nodes.length - 1 && game.eval) {
        moveScore = parseLichessEvalToScore(game.eval);
      }

      const existingAnnotation = node.annotations.find(isBasicAnnotation) || null;
      const isBook = movePly <= effectiveBookPlies;

      const { annotation: moveAnnotation, winChanceDiff } = classifyMove({
        ply: movePly,
        movingColor,
        prevScore: prevScore?.value || null,
        currScore: moveScore?.value || null,
        isBook,
        prevOpponentWinChanceDiff,
        existingAnnotation,
      });

      const destSquare: Square | undefined = match(node)
        .with({ san: "O-O" }, ({ halfMoves }) => parseSquare(halfMoves % 2 === 1 ? "g1" : "g8") ?? undefined)
        .with({ san: "O-O-O" }, ({ halfMoves }) => parseSquare(halfMoves % 2 === 1 ? "c1" : "c8") ?? undefined)
        .otherwise((n) => (n && n.move && isNormal(n.move) ? n.move.to : undefined));

      if (node.san) {
        list.push({
          ply: movePly,
          san: node.san,
          path: Array.from({ length: movePly }, () => 0),
          score: moveScore || null,
          annotation: moveAnnotation,
          fen: node.fen,
          destSquare,
        });
      }

      if (moveScore) {
        prevScore = moveScore;
      }
      prevOpponentWinChanceDiff = winChanceDiff;
    }
    return list;
  }, [rootNode, game.eval, effectiveBookPlies]);

  // Current move item & annotation for board display
  const currentMoveItem = useMemo(() => {
    return movesList.find((m) => m.ply === position.length);
  }, [movesList, position.length]);

  const currentMoveAnnotation =
    currentMoveItem?.annotation || currentNode.annotations.find(isBasicAnnotation);
  const currentMoveDestSquare = currentMoveItem?.destSquare;

  // Determine score to display in the EvalBar:
  // Prefer live local engine score when available, otherwise Lichess broadcast score
  const broadcastScore = useMemo(() => parseLichessEvalToScore(game.eval), [game.eval]);
  const displayScore = currentNode.score || broadcastScore;

  // Top/bottom player assignments based on orientation
  const topPlayer = orientation === "white" ? "black" : "white";
  const bottomPlayer = orientation === "white" ? "white" : "black";


  const getPlayerDetails = (side: "white" | "black") => {
    return {
      name: side === "white" ? game.white : game.black,
      title: side === "white" ? game.whiteTitle : game.blackTitle,
      elo: side === "white" ? game.whiteElo : game.blackElo,
      team: side === "white" ? game.whiteTeam : game.blackTeam,
      fideId: side === "white" ? game.whiteFideId : game.blackFideId,
    };
  };

  const topDetails = getPlayerDetails(topPlayer);
  const bottomDetails = getPlayerDetails(bottomPlayer);

  // Mini Player (Picture-in-Picture) state & channel sync
  const [isPipActive, setIsPipActive] = useState(false);
  const pipChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    invoke<boolean>("is_pip_window_open")
      .then((isOpen) => setIsPipActive(isOpen))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PIP_CHANNEL_NAME);
      pipChannelRef.current = channel;

      channel.onmessage = (event) => {
        if (event.data?.type === "REQUEST_STATE") {
          if (latestPipStateRef.current) {
            channel?.postMessage({
              type: "SYNC_STATE",
              state: latestPipStateRef.current,
            });
          }
        } else if (event.data?.type === "PIP_CLOSED") {
          setIsPipActive(false);
        }
      };
    } catch (err) {
      console.warn("Failed to create BroadcastChannel in LiveGameView:", err);
    }

    return () => {
      try {
        channel?.close();
      } catch {}
      pipChannelRef.current = null;
    };
  }, []);

  const currentPipState = useMemo((): PipState => {
    return {
      white: {
        name: game.white,
        title: game.whiteTitle,
        elo: game.whiteElo,
        fideId: game.whiteFideId,
        time: parseClockToSeconds(game.whiteClk),
      },
      black: {
        name: game.black,
        title: game.blackTitle,
        elo: game.blackElo,
        fideId: game.blackFideId,
        time: parseClockToSeconds(game.blackClk),
      },
      turn: turnColor,
      isOngoing,
      fen: currentNode.fen,
      orientation,
      evalScore: engineMode !== "off" ? (displayScore ?? null) : null,
      evalDepth: engineMode !== "off" ? (currentLines[0]?.depth ?? null) : null,
      evalMode: engineMode,
      shapes: engineShapes,
      boardTitle: `${game.white} vs ${game.black}`,
    };
  }, [
    game.white,
    game.whiteTitle,
    game.whiteElo,
    game.whiteFideId,
    game.whiteClk,
    game.black,
    game.blackTitle,
    game.blackElo,
    game.blackFideId,
    game.blackClk,
    turnColor,
    isOngoing,
    currentNode.fen,
    orientation,
    engineMode,
    displayScore,
    currentLines,
    engineShapes,
  ]);

  const latestPipStateRef = useRef<PipState>(currentPipState);
  latestPipStateRef.current = currentPipState;

  useEffect(() => {
    try {
      localStorage.setItem(PIP_STORAGE_KEY, JSON.stringify(currentPipState));
      if (isPipActive && pipChannelRef.current) {
        pipChannelRef.current.postMessage({
          type: "SYNC_STATE",
          state: currentPipState,
        });
      }
    } catch {}
  }, [currentPipState, isPipActive]);

  const handleTogglePip = useCallback(async () => {
    try {
      const isOpen = await invoke<boolean>("is_pip_window_open");
      if (isOpen) {
        await invoke("close_pip_window");
        setIsPipActive(false);
      } else {
        await invoke("open_pip_window");
        setIsPipActive(true);
      }
    } catch (err) {
      console.error("Failed to toggle PiP window:", err);
    }
  }, []);

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

            <Tooltip label={isPipActive ? "Close Mini Player (Always on Top)" : "Pop up Mini Player (Always on Top)"}>
              <ActionIcon
                variant={isPipActive ? "filled" : "default"}
                color={isPipActive ? "teal" : undefined}
                size="sm"
                onClick={handleTogglePip}
              >
                <IconPictureInPicture size={16} />
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
            rawClk={topPlayer === "white" ? game.whiteClk : game.blackClk}
            isTurn={turnColor === topPlayer && isOngoing}
            isBlack={topPlayer === "black"}
            isOngoing={isOngoing}
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
              {currentMoveAnnotation && currentMoveDestSquare !== undefined && (
                <Box
                  w="100%"
                  h="100%"
                  pos="absolute"
                  top={0}
                  left={0}
                  style={{ pointerEvents: "none", zIndex: 10 }}
                >
                  <AnnotationHint
                    orientation={orientation}
                    square={currentMoveDestSquare}
                    annotation={currentMoveAnnotation}
                  />
                </Box>
              )}
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
            rawClk={bottomPlayer === "white" ? game.whiteClk : game.blackClk}
            isTurn={turnColor === bottomPlayer && isOngoing}
            isBlack={bottomPlayer === "black"}
            isOngoing={isOngoing}
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

            <Group gap={6} align="center">
              {firstLoadedEngine && engineMode !== "off" && (
                <Button
                  size="compact-xs"
                  variant={isReviewing ? "filled" : "light"}
                  color="teal"
                  loading={isReviewing}
                  leftSection={<IconZoomCheck size={14} />}
                  onClick={() => runLiveGameReview(true)}
                  title="Game Review (Stockfish Depth 20)"
                >
                  {isReviewing
                    ? `Reviewing (${reviewProgress > 0 ? `${Math.round(reviewProgress)}%` : "D20"})...`
                    : countUnanalyzedMoves(rootNode) === 0
                      ? "Review ✓"
                      : "Review"}
                </Button>
              )}

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
          </Group>

          {/* Progress indicator for Game Review calculation at Depth 20 */}
          {isReviewing && (
            <Progress
              value={reviewProgress > 0 ? reviewProgress : 100}
              animated
              size={3}
              color="teal"
              striped
            />
          )}

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
              showEval={engineMode !== "off"}
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

function parseClockToSeconds(clk?: string): number | undefined {
  if (!clk) return undefined;
  const parts = clk.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => isNaN(p))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return undefined;
}

function formatClockSeconds(seconds: number | null | undefined): string | undefined {
  if (seconds === null || seconds === undefined) return undefined;
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
}

function LiveClockBadge({
  rawClk,
  isTurn,
  isOngoing,
}: {
  rawClk?: string;
  isTurn: boolean;
  isOngoing: boolean;
}) {
  const initialSeconds = useMemo(() => parseClockToSeconds(rawClk) ?? null, [rawClk]);
  const [seconds, setSeconds] = useState<number | null>(initialSeconds);
  const syncRef = useRef<{ time: number; base: number | null }>({
    time: Date.now(),
    base: initialSeconds,
  });

  useEffect(() => {
    const s = parseClockToSeconds(rawClk) ?? null;
    syncRef.current = { time: Date.now(), base: s };
    setSeconds(s);
  }, [rawClk]);

  useEffect(() => {
    if (!isOngoing || !isTurn || syncRef.current.base === null) return;

    const timer = setInterval(() => {
      const elapsed = (Date.now() - syncRef.current.time) / 1000;
      const base = syncRef.current.base;
      if (base !== null) {
        setSeconds(Math.max(0, base - elapsed));
      }
    }, 250);

    return () => clearInterval(timer);
  }, [isTurn, isOngoing]);

  const formatted = formatClockSeconds(seconds);
  if (!formatted) return null;

  return <span className={classes.clockBadge}>{formatted}</span>;
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
  rawClk,
  isTurn,
  isBlack,
  isOngoing,
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
  rawClk?: string;
  isTurn: boolean;
  isBlack: boolean;
  isOngoing: boolean;
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

      <LiveClockBadge rawClk={rawClk} isTurn={isTurn} isOngoing={isOngoing} />
    </Group>
  );
}

function MoveItemCell({
  move,
  isCurrent,
  showEval,
}: {
  move: LiveMoveItem;
  isCurrent: boolean;
  showEval: boolean;
}) {
  const color = getReviewColor(move.annotation);

  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap={4} style={{ width: "100%" }}>
      <Text size="xs" fw={isCurrent ? 700 : 500} style={{ flexShrink: 0 }}>
        {move.san}
      </Text>
      {showEval && (
        <Group gap={4} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
          {move.score && (
            <Text
              size="xs"
              ff="monospace"
              style={{
                color: move.annotation ? color : "var(--mantine-color-dimmed)",
                opacity: move.annotation ? 0.95 : 0.65,
                fontSize: "0.72rem",
                fontWeight: move.annotation ? 700 : 400,
              }}
            >
              {formatScore(move.score.value, 1)}
            </Text>
          )}
          {move.annotation && (
            <AnnotationBadge annotation={move.annotation} size={15} />
          )}
        </Group>
      )}
    </Group>
  );
}

function MoveTable({
  moves,
  currentPly,
  showEval,
  onSelectMove,
}: {
  moves: LiveMoveItem[];
  currentPly: number;
  showEval: boolean;
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
  const rows: {
    moveNum: number;
    white?: LiveMoveItem;
    black?: LiveMoveItem;
  }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    rows.push({
      moveNum,
      white: moves[i],
      black: moves[i + 1],
    });
  }

  return (
    <Table verticalSpacing={3} horizontalSpacing={4} style={{ fontSize: "0.85rem" }}>
      <Table.Tbody>
        {rows.map((row) => {
          const isActiveRow =
            row.white?.ply === currentPly || row.black?.ply === currentPly;
          return (
            <Table.Tr
              key={row.moveNum}
              ref={isActiveRow ? activeRowRef : undefined}
            >
              <Table.Td style={{ width: 34, color: "var(--mantine-color-dimmed)", padding: "2px 4px" }}>
                {row.moveNum}.
              </Table.Td>
              <Table.Td
                onClick={() => row.white && onSelectMove(row.white.path)}
                style={{
                  cursor: "pointer",
                  borderRadius: "4px",
                  padding: "2px 4px",
                  backgroundColor:
                    row.white?.ply === currentPly
                      ? "var(--mantine-color-blue-light)"
                      : undefined,
                }}
              >
                {row.white && (
                  <MoveItemCell
                    move={row.white}
                    isCurrent={row.white.ply === currentPly}
                    showEval={showEval}
                  />
                )}
              </Table.Td>
              <Table.Td
                onClick={() => row.black && onSelectMove(row.black.path)}
                style={{
                  cursor: "pointer",
                  borderRadius: "4px",
                  padding: "2px 4px",
                  backgroundColor:
                    row.black?.ply === currentPly
                      ? "var(--mantine-color-blue-light)"
                      : undefined,
                }}
              >
                {row.black && (
                  <MoveItemCell
                    move={row.black}
                    isCurrent={row.black.ply === currentPly}
                    showEval={showEval}
                  />
                )}
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
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: LINE_HEX_COLORS[idx] || "#003088",
                  flexShrink: 0,
                }}
              />
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

