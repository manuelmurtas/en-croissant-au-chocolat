import {
  Badge,
  Box,
  Group,
  Pagination,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import cx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { BroadcastGameSummary } from "@/utils/lichess/broadcast";
import classes from "./Broadcasts.module.css";

interface BroadcastBoardListProps {
  games: BroadcastGameSummary[];
  selectedGameId: string | null;
  onSelectGame: (game: BroadcastGameSummary) => void;
}

const PAGE_SIZE = 10;

export default function BroadcastBoardList({
  games,
  selectedGameId,
  onSelectGame,
}: BroadcastBoardListProps) {
  const [filter, setFilter] = useState("");
  const [onlyOngoing, setOnlyOngoing] = useState(false);
  const [page, setPage] = useState(1);

  const liveCount = useMemo(() => games.filter((g) => g.result === "*").length, [games]);

  const filteredGames = useMemo(() => {
    let result = games;
    if (onlyOngoing) {
      result = result.filter((g) => g.result === "*");
    }
    if (!filter.trim()) return result;
    const q = filter.toLowerCase();
    return result.filter((g) => {
      return (
        g.white.toLowerCase().includes(q) ||
        g.black.toLowerCase().includes(q) ||
        (g.whiteTeam && g.whiteTeam.toLowerCase().includes(q)) ||
        (g.blackTeam && g.blackTeam.toLowerCase().includes(q)) ||
        `board ${g.boardNumber}`.includes(q)
      );
    });
  }, [games, filter, onlyOngoing]);

  // Reset page when filter or status toggle changes
  useEffect(() => {
    setPage(1);
  }, [filter, onlyOngoing]);

  // Keep active board visible in current page
  useEffect(() => {
    if (!selectedGameId) return;
    const index = filteredGames.findIndex((g) => g.id === selectedGameId);
    if (index !== -1) {
      const targetPage = Math.floor(index / PAGE_SIZE) + 1;
      setPage(targetPage);
    }
  }, [selectedGameId, filteredGames]);

  const totalPages = Math.ceil(filteredGames.length / PAGE_SIZE);
  const paginatedGames = useMemo(() => {
    return filteredGames.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [filteredGames, page]);

  return (
    <Stack gap="xs" style={{ height: "100%", overflow: "hidden" }}>
      <Box p="xs" pb={0}>
        <TextInput
          placeholder="Filter boards or players..."
          leftSection={<IconSearch size={14} />}
          size="xs"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
        <Group justify="space-between" align="center" mt={6}>
          <Switch
            size="xs"
            label="Only ongoing games"
            checked={onlyOngoing}
            onChange={(e) => setOnlyOngoing(e.currentTarget.checked)}
          />
          <Badge size="xs" variant="light" color={liveCount > 0 ? "blue" : "gray"}>
            {liveCount} live
          </Badge>
        </Group>
        <Group justify="space-between" mt={4}>
          <Text size="xs" c="dimmed">
            {filteredGames.length} {filteredGames.length === 1 ? "Board" : "Boards"}
          </Text>
          {totalPages > 1 && (
            <Text size="xs" c="dimmed">
              Page {page} of {totalPages}
            </Text>
          )}
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <Stack gap={4} p="xs">
          {filteredGames.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="md">
              {onlyOngoing ? "No ongoing games in this round" : "No boards found"}
            </Text>
          ) : (
            paginatedGames.map((game) => {
              const isSelected = game.id === selectedGameId;
              const evalNum = game.eval ? parseFloat(game.eval) : null;
              const evalBadgeColor =
                evalNum !== null
                  ? evalNum > 0.8
                    ? "teal"
                    : evalNum < -0.8
                      ? "red"
                      : "gray"
                  : "gray";

              return (
                <Box
                  key={game.id}
                  className={cx(classes.boardListItem, {
                    [classes.boardListItemActive]: isSelected,
                  })}
                  onClick={() => onSelectGame(game)}
                >
                  <Group justify="space-between" align="center" wrap="nowrap" mb={2}>
                    <Badge size="xs" variant="outline" color="gray">
                      Board {game.boardNumber}
                    </Badge>

                    <Group gap={4} wrap="nowrap">
                      {game.eval && (
                        <Badge size="xs" variant="light" color={evalBadgeColor}>
                          {game.eval.startsWith("#") ? game.eval : `${evalNum && evalNum > 0 ? "+" : ""}${game.eval}`}
                        </Badge>
                      )}
                      <Badge
                        size="xs"
                        variant={game.result === "*" ? "light" : "filled"}
                        color={game.result === "*" ? "blue" : "dark"}
                      >
                        {game.result}
                      </Badge>
                    </Group>
                  </Group>

                  {/* White player */}
                  <Group justify="space-between" align="center" wrap="nowrap" gap={4}>
                    <Group gap={4} wrap="nowrap" style={{ overflow: "hidden" }}>
                      <Box
                        w={8}
                        h={8}
                        style={{
                          borderRadius: "50%",
                          border: "1px solid var(--mantine-color-gray-5)",
                          backgroundColor: "#fff",
                          flexShrink: 0,
                        }}
                      />
                      {game.whiteTitle && (
                        <Text size="xs" fw={700} c="orange">
                          {game.whiteTitle}
                        </Text>
                      )}
                      <Text size="xs" fw={500} lineClamp={1}>
                        {game.white}
                      </Text>
                      {game.whiteElo && (
                        <Text size="xs" c="dimmed">
                          ({game.whiteElo})
                        </Text>
                      )}
                    </Group>

                    {game.whiteClk && (
                      <Text size="xs" c="dimmed" ff="monospace">
                        {game.whiteClk.slice(0, 7)}
                      </Text>
                    )}
                  </Group>

                  {/* Black player */}
                  <Group justify="space-between" align="center" wrap="nowrap" gap={4} mt={1}>
                    <Group gap={4} wrap="nowrap" style={{ overflow: "hidden" }}>
                      <Box
                        w={8}
                        h={8}
                        style={{
                          borderRadius: "50%",
                          backgroundColor: "#111",
                          border: "1px solid var(--mantine-color-gray-6)",
                          flexShrink: 0,
                        }}
                      />
                      {game.blackTitle && (
                        <Text size="xs" fw={700} c="orange">
                          {game.blackTitle}
                        </Text>
                      )}
                      <Text size="xs" fw={500} lineClamp={1}>
                        {game.black}
                      </Text>
                      {game.blackElo && (
                        <Text size="xs" c="dimmed">
                          ({game.blackElo})
                        </Text>
                      )}
                    </Group>

                    {game.blackClk && (
                      <Text size="xs" c="dimmed" ff="monospace">
                        {game.blackClk.slice(0, 7)}
                      </Text>
                    )}
                  </Group>

                  {/* Last move / opening info */}
                  {(game.lastMove || game.opening) && (
                    <Group justify="space-between" mt={4}>
                      <Text size="xs" c="dimmed" lineClamp={1} style={{ maxWidth: "60%" }}>
                        {game.opening || game.eco || ""}
                      </Text>
                      {game.lastMove && (
                        <Text size="xs" fw={600} c="blue">
                          {game.lastMove}
                        </Text>
                      )}
                    </Group>
                  )}
                </Box>
              );
            })
          )}
        </Stack>
      </ScrollArea>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <Group justify="center" p="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          <Pagination
            total={totalPages}
            value={page}
            onChange={setPage}
            size="xs"
            siblings={1}
            boundaries={1}
          />
        </Group>
      )}
    </Stack>
  );
}
