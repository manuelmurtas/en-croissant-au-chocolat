import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Color } from "@lichess-org/chessground/types";
import { ActionIcon, Badge, Box, Center, Group, Loader, Text } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconX } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Score } from "@/bindings";
import { Chessground } from "@/chessground/Chessground";
import type { BroadcastEngineMode } from "@/state/atoms";
import { formatScore } from "@/utils/score";

export const PIP_CHANNEL_NAME = "encroissant_broadcast_pip";
export const PIP_STORAGE_KEY = "encroissant_pip_state";

export interface PipPlayerInfo {
  name: string;
  title?: string;
  elo?: string | number;
  fideId?: string;
  time?: number; // seconds
}

export interface PipState {
  white: PipPlayerInfo;
  black: PipPlayerInfo;
  turn: Color;
  isOngoing: boolean;
  fen: string;
  orientation: Color;
  evalScore: Score | null;
  evalDepth: number | null;
  evalMode: BroadcastEngineMode;
  shapes: DrawShape[];
  boardTitle: string;
}

function formatClock(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return "-:--";
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function calculateWinPercentage(score: Score | null): number {
  if (!score) return 50;
  if (score.value.type === "mate") {
    return score.value.value > 0 ? 100 : 0;
  }
  const cp = score.value.value;
  // Lichess standard sigmoid win probability formula
  const winPercent = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
  return Math.max(0, Math.min(100, winPercent));
}

function MiniPlayerRow({
  player,
  color,
  time,
  isTurn,
  onClose,
}: {
  player: PipPlayerInfo;
  color: Color;
  time: number | undefined;
  isTurn: boolean;
  onClose?: () => void;
}) {
  return (
    <Group
      justify="space-between"
      align="center"
      wrap="nowrap"
      px={8}
      py={2}
      style={{
        height: 28,
        minHeight: 28,
        flexShrink: 0,
        backgroundColor: isTurn ? "rgba(34, 139, 230, 0.16)" : "transparent",
        borderRadius: 4,
        transition: "background-color 0.2s ease",
        userSelect: "none",
      }}
      data-tauri-drag-region
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0, overflow: "hidden" }} data-tauri-drag-region>
        {/* Color indicator badge */}
        <Box
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: color === "white" ? "#f8f9fa" : "#212529",
            border: color === "white" ? "1.5px solid #868e96" : "1.5px solid #ced4da",
            flexShrink: 0,
          }}
        />

        {player.title && (
          <Badge size="xs" variant="filled" color="yellow" style={{ fontSize: 9, padding: "0 4px", height: 16 }}>
            {player.title}
          </Badge>
        )}

        <Text
          size="xs"
          fw={isTurn ? 700 : 500}
          lineClamp={1}
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.2,
          }}
        >
          {player.name || (color === "white" ? "White" : "Black")}
        </Text>

        {player.elo ? (
          <Text size="10px" c="dimmed" style={{ flexShrink: 0 }}>
            ({player.elo})
          </Text>
        ) : null}
      </Group>

      <Group gap={4} wrap="nowrap" align="center">
        {/* Live Digital Clock */}
        <Box
          px={6}
          py={1}
          style={{
            borderRadius: 4,
            backgroundColor: isTurn ? "var(--mantine-color-blue-filled)" : "var(--mantine-color-dark-6)",
            color: isTurn ? "#ffffff" : "var(--mantine-color-gray-3)",
            fontWeight: 700,
            fontFamily: "monospace",
            fontSize: 12,
            flexShrink: 0,
            letterSpacing: 0.5,
            boxShadow: isTurn ? "0 0 6px rgba(34, 139, 230, 0.4)" : "none",
          }}
        >
          {formatClock(time)}
        </Box>

        {onClose && (
          <ActionIcon
            size="xs"
            variant="subtle"
            color="gray"
            onClick={onClose}
            title="Close Mini Player"
            style={{ flexShrink: 0 }}
          >
            <IconX size={13} />
          </ActionIcon>
        )}
      </Group>
    </Group>
  );
}

function SlimPipEvalBar({
  score,
  orientation,
  height,
}: {
  score: Score | null;
  orientation: Color;
  height: number;
}) {
  const whitePercent = useMemo(() => calculateWinPercentage(score), [score]);
  const isWhiteBottom = orientation === "white";

  const topPercent = isWhiteBottom ? 100 - whitePercent : whitePercent;
  const bottomPercent = isWhiteBottom ? whitePercent : 100 - whitePercent;

  const topBg = isWhiteBottom ? "#212529" : "#f1f3f5";
  const bottomBg = isWhiteBottom ? "#f1f3f5" : "#212529";

  const formatted = score ? formatScore(score.value, 1) : null;

  return (
    <Box
      style={{
        width: 12,
        height,
        borderRadius: 2,
        overflow: "hidden",
        border: "1px solid var(--mantine-color-dark-4)",
        backgroundColor: "#141517",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "relative",
      }}
      title={formatted ? `Eval: ${formatted}` : undefined}
    >
      <Box
        style={{
          height: `${topPercent}%`,
          backgroundColor: topBg,
          transition: "height 0.25s ease",
        }}
      />
      <Box
        style={{
          height: `${bottomPercent}%`,
          backgroundColor: bottomBg,
          transition: "height 0.25s ease",
        }}
      />
    </Box>
  );
}

export default function PipGameView() {
  // Synchronous hydration from localStorage cache to prevent visual flicker on launch
  const [state, setState] = useState<PipState | null>(() => {
    try {
      const cached = localStorage.getItem(PIP_STORAGE_KEY);
      if (cached) return JSON.parse(cached) as PipState;
    } catch {}
    return null;
  });

  const syncTimestampRef = useRef<number>(performance.now());
  const baseClocksRef = useRef<{ white?: number; black?: number }>({});

  const [currentWhiteClk, setCurrentWhiteClk] = useState<number | undefined>(
    state?.white?.time,
  );
  const [currentBlackClk, setCurrentBlackClk] = useState<number | undefined>(
    state?.black?.time,
  );

  // Setup BroadcastChannel communication with main window
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PIP_CHANNEL_NAME);

      channel.onmessage = (event) => {
        if (event.data?.type === "SYNC_STATE" && event.data.state) {
          const newState = event.data.state as PipState;
          setState(newState);
          syncTimestampRef.current = performance.now();
          baseClocksRef.current = {
            white: newState.white?.time,
            black: newState.black?.time,
          };
          setCurrentWhiteClk(newState.white?.time);
          setCurrentBlackClk(newState.black?.time);

          if (newState.boardTitle) {
            try {
              getCurrentWebviewWindow().setTitle(newState.boardTitle);
            } catch {}
          }
        }
      };

      // Request latest state immediately on mount
      channel.postMessage({ type: "REQUEST_STATE" });
    } catch (err) {
      console.warn("Failed to create BroadcastChannel in PipGameView:", err);
    }

    const handleBeforeUnload = () => {
      try {
        channel?.postMessage({ type: "PIP_CLOSED" });
      } catch {}
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      try {
        channel?.postMessage({ type: "PIP_CLOSED" });
        channel?.close();
      } catch {}
    };
  }, []);

  // High-frequency live ticking clock for the active player on turn
  useEffect(() => {
    if (!state || !state.isOngoing) return;

    const interval = setInterval(() => {
      const elapsed = (performance.now() - syncTimestampRef.current) / 1000;

      if (state.turn === "white" && typeof baseClocksRef.current.white === "number") {
        setCurrentWhiteClk(Math.max(0, baseClocksRef.current.white - elapsed));
      } else {
        setCurrentWhiteClk(baseClocksRef.current.white);
      }

      if (state.turn === "black" && typeof baseClocksRef.current.black === "number") {
        setCurrentBlackClk(Math.max(0, baseClocksRef.current.black - elapsed));
      } else {
        setCurrentBlackClk(baseClocksRef.current.black);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [state?.isOngoing, state?.turn]);

  // Responsive board sizing within the floating window
  const { ref: containerRef, width: containerWidth, height: containerHeight } = useElementSize();

  const hasEvalBar = Boolean(state && state.evalMode !== "off");
  const evalBarWidth = hasEvalBar ? 18 : 0; // 12px bar + 6px gap

  const boardSize = useMemo(() => {
    if (!containerWidth || !containerHeight) return 180;
    const availableWidth = containerWidth - evalBarWidth - 8;
    const availableHeight = containerHeight - 8;
    return Math.max(120, Math.floor(Math.min(availableWidth, availableHeight)));
  }, [containerWidth, containerHeight, evalBarWidth]);

  if (!state) {
    return (
      <Center h="100vh" bg="#141517">
        <Center style={{ flexDirection: "column", gap: 10 }}>
          <Loader size="sm" color="blue" />
          <Text size="xs" c="dimmed">
            Waiting for live broadcast...
          </Text>
        </Center>
      </Center>
    );
  }

  const topColor: Color = state.orientation === "white" ? "black" : "white";
  const bottomColor: Color = state.orientation === "white" ? "white" : "black";

  const topPlayer = topColor === "white" ? state.white : state.black;
  const bottomPlayer = bottomColor === "white" ? state.white : state.black;

  const topTime = topColor === "white" ? currentWhiteClk : currentBlackClk;
  const bottomTime = bottomColor === "white" ? currentWhiteClk : currentBlackClk;

  const isTopTurn = state.isOngoing && state.turn === topColor;
  const isBottomTurn = state.isOngoing && state.turn === bottomColor;

  const handleClose = async () => {
    try {
      await getCurrentWebviewWindow().close();
    } catch {
      try {
        await invoke("close_pip_window");
      } catch {}
    }
  };

  return (
    <Box
      h="100vh"
      w="100vw"
      bg="#141517"
      p={4}
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
      data-tauri-drag-region
    >
      {/* Top Player Row */}
      <MiniPlayerRow
        player={topPlayer}
        color={topColor}
        time={topTime}
        isTurn={isTopTurn}
        onClose={handleClose}
      />

      {/* Middle Board Area */}
      <Box
        ref={containerRef}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
        }}
        data-tauri-drag-region
      >
        <Group gap={6} align="center" justify="center" wrap="nowrap">
          {/* Eval Bar */}
          {hasEvalBar && (
            <SlimPipEvalBar
              score={state.evalScore}
              orientation={state.orientation}
              height={boardSize}
            />
          )}

          {/* Chessboard */}
          <Box
            style={{
              width: boardSize,
              height: boardSize,
              position: "relative",
              borderRadius: 3,
              overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
            }}
          >
            <Chessground
              fen={state.fen}
              orientation={state.orientation}
              turnColor={state.turn}
              movable={{ free: false }}
              draggable={{ enabled: false }}
              selectable={{ enabled: false }}
              viewOnly={true}
              coordinates={false}
              drawable={{
                enabled: true,
                visible: true,
                autoShapes: state.shapes,
              }}
            />
          </Box>
        </Group>
      </Box>

      {/* Bottom Player Row */}
      <MiniPlayerRow
        player={bottomPlayer}
        color={bottomColor}
        time={bottomTime}
        isTurn={isBottomTurn}
      />
    </Box>
  );
}
