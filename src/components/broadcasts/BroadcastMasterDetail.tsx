import { Box, Text } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useEffect, useState } from "react";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import type { BroadcastGameSummary } from "@/utils/lichess/broadcast";
import { createTab } from "@/utils/tabs";
import BroadcastBoardList from "./BroadcastBoardList";
import LiveGameView from "./LiveGameView";

interface BroadcastMasterDetailProps {
  games: BroadcastGameSummary[];
  tourName?: string;
}

export default function BroadcastMasterDetail({
  games,
  tourName,
}: BroadcastMasterDetailProps) {
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [, setTabs] = useAtom(tabsAtom);
  const [, setActiveTab] = useAtom(activeTabAtom);
  const navigate = useNavigate();

  // Default to first ongoing game when list loads (or games[0] if all completed)
  useEffect(() => {
    if (games.length > 0) {
      if (!selectedGameId || !games.some((g) => g.id === selectedGameId)) {
        const firstOngoing = games.find((g) => g.result === "*");
        setSelectedGameId(firstOngoing ? firstOngoing.id : games[0].id);
      }
    }
  }, [games, selectedGameId]);

  const activeGame = games.find((g) => g.id === selectedGameId) || games[0];

  const handleOpenAnalysisTab = async (pgn: string, tabName: string) => {
    await createTab({
      tab: {
        name: tabName,
        type: "analysis",
      },
      setTabs,
      setActiveTab,
      pgn,
    });
    navigate({ to: "/" });
  };

  if (!games || games.length === 0) {
    return (
      <Box
        h="100%"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text c="dimmed">No games found for this round yet.</Text>
      </Box>
    );
  }

  return (
    <Box h="100%" style={{ display: "flex", overflow: "hidden" }}>
      {/* Central Interactive Live Game */}
      <Box style={{ flex: 1, height: "100%", overflow: "hidden" }}>
        {activeGame && (
          <LiveGameView
            key={activeGame.id}
            game={activeGame}
            tourName={tourName}
            onOpenAnalysisTab={handleOpenAnalysisTab}
          />
        )}
      </Box>

      {/* Right: Board Selector List */}
      <Box
        w={{ base: 260, sm: 300, md: 340 }}
        style={{
          height: "100%",
          borderLeft: "1px solid var(--mantine-color-default-border)",
          backgroundColor: "var(--mantine-color-body)",
        }}
      >
        <BroadcastBoardList
          games={games}
          selectedGameId={activeGame?.id || null}
          onSelectGame={(g) => setSelectedGameId(g.id)}
        />
      </Box>
    </Box>
  );
}

