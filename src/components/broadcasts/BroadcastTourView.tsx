import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Tabs,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconExternalLink,
  IconMapPin,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  type BroadcastRound,
  type BroadcastTour,
  fetchRoundPgn,
  fetchTourDetail,
  parseBroadcastGames,
} from "@/utils/lichess/broadcast";
import BroadcastMasterDetail from "./BroadcastMasterDetail";
import classes from "./Broadcasts.module.css";

interface BroadcastTourViewProps {
  tour: BroadcastTour;
  onBack: () => void;
}

const REFRESH_INTERVALS = [
  { value: "3", label: "3s (Bullet)" },
  { value: "5", label: "5s (Blitz)" },
  { value: "7", label: "7s (Default)" },
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
];

export default function BroadcastTourView({
  tour,
  onBack,
}: BroadcastTourViewProps) {
  // Fetch tournament full details (rounds list)
  const {
    data: tourDetail,
    isLoading: isTourLoading,
  } = useSWR(["broadcast-tour-detail", tour.id], () => fetchTourDetail(tour.id), {
    revalidateOnFocus: false,
  });

  const rounds = useMemo(() => tourDetail?.rounds || [], [tourDetail]);

  // Selected round ID (defaults to defaultRoundId or ongoing round or last round)
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);

  useEffect(() => {
    if (rounds.length > 0 && !selectedRoundId) {
      if (tourDetail?.defaultRoundId) {
        setSelectedRoundId(tourDetail.defaultRoundId);
      } else {
        const ongoingRound = rounds.find((r) => r.ongoing);
        if (ongoingRound) {
          setSelectedRoundId(ongoingRound.id);
        } else {
          setSelectedRoundId(rounds[rounds.length - 1].id);
        }
      }
    }
  }, [rounds, selectedRoundId, tourDetail?.defaultRoundId]);

  const activeRound = rounds.find((r) => r.id === selectedRoundId) || rounds[0];

  // Auto-refresh interval setting (persisted in localStorage)
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(() => {
    const saved = localStorage.getItem("broadcast-refresh-interval");
    return saved ? parseInt(saved, 10) : 7;
  });

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rawPgn, setRawPgn] = useState<string>("");

  const handleIntervalChange = (val: string | null) => {
    if (!val) return;
    const sec = parseInt(val, 10);
    setRefreshIntervalSec(sec);
    localStorage.setItem("broadcast-refresh-interval", val);
  };

  // Function to load round PGN
  const loadPgn = useCallback(async () => {
    if (!selectedRoundId) return;
    setIsRefreshing(true);
    try {
      const pgn = await fetchRoundPgn(selectedRoundId);
      setRawPgn(pgn);
    } catch (err) {
      console.error("Failed to fetch broadcast round PGN", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedRoundId]);

  // Initial load when selected round changes
  useEffect(() => {
    if (selectedRoundId) {
      loadPgn();
    }
  }, [selectedRoundId, loadPgn]);

  // Polling timer when round is active and autoRefresh is ON
  useEffect(() => {
    if (!autoRefresh || !selectedRoundId) return;

    const timer = setInterval(() => {
      loadPgn();
    }, refreshIntervalSec * 1000);

    return () => clearInterval(timer);
  }, [autoRefresh, selectedRoundId, refreshIntervalSec, loadPgn]);

  // Parse games from raw PGN
  const parsedGames = useMemo(() => {
    return parseBroadcastGames(rawPgn);
  }, [rawPgn]);

  return (
    <Box h="100%" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header Bar */}
      <Box
        p="sm"
        px="md"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
          backgroundColor: "var(--mantine-color-body)",
        }}
      >
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="sm">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
              onClick={onBack}
            >
              Tournaments
            </Button>

            <Box>
              <Group gap="xs" align="center">
                <Title order={4} lineClamp={1}>
                  {tour.name}
                </Title>
                {activeRound?.ongoing && (
                  <Badge color="red" variant="filled" className={classes.liveBadge}>
                    <span className={classes.pulseDot} />
                    LIVE
                  </Badge>
                )}
              </Group>

              {tour.info?.location && (
                <Group gap={4} mt={2}>
                  <IconMapPin size={12} opacity={0.6} />
                  <Text size="xs" c="dimmed">
                    {tour.info.location}
                  </Text>
                  {tour.info.tc && (
                    <Text size="xs" c="dimmed">
                      • {tour.info.tc}
                    </Text>
                  )}
                </Group>
              )}
            </Box>
          </Group>

          {/* Live Sync Controls */}
          <Group gap="xs" align="center">
            {/* Live Indicator */}
            {activeRound?.ongoing && autoRefresh && (
              <Group gap={6} align="center">
                <span className={classes.pulseDotGreen} />
                <Text size="xs" c="teal" fw={600}>
                  Live Sync
                </Text>
              </Group>
            )}

            {/* Interval selector */}
            <Select
              size="xs"
              w={120}
              data={REFRESH_INTERVALS}
              value={refreshIntervalSec.toString()}
              onChange={handleIntervalChange}
              title="Auto-refresh speed"
            />

            {/* Pause/Play toggle */}
            <Tooltip label={autoRefresh ? "Pause auto-sync" : "Resume auto-sync"}>
              <ActionIcon
                variant={autoRefresh ? "light" : "default"}
                color={autoRefresh ? "teal" : "gray"}
                size="input-sm"
                onClick={() => setAutoRefresh((a) => !a)}
              >
                {autoRefresh ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
              </ActionIcon>
            </Tooltip>

            {/* Manual refresh */}
            <Tooltip label="Refresh now">
              <ActionIcon
                variant="default"
                size="input-sm"
                loading={isRefreshing}
                onClick={loadPgn}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>

            {/* Lichess page */}
            <Tooltip label="Open on Lichess">
              <ActionIcon
                variant="default"
                size="input-sm"
                onClick={() => openUrl(tour.url)}
              >
                <IconExternalLink size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Rounds Tabs Selector */}
        {rounds.length > 1 && (
          <Box mt="xs">
            <Tabs
              value={selectedRoundId || undefined}
              onChange={(val) => val && setSelectedRoundId(val)}
            >
              <Tabs.List>
                {rounds.map((round) => (
                  <Tabs.Tab
                    key={round.id}
                    value={round.id}
                    leftSection={
                      round.ongoing ? (
                        <span className={classes.pulseDot} style={{ width: 6, height: 6 }} />
                      ) : undefined
                    }
                  >
                    {round.name} {round.ongoing ? "(Live)" : ""}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
          </Box>
        )}
      </Box>

      {/* Main Game Viewer area */}
      <Box style={{ flex: 1, overflow: "hidden" }}>
        {isTourLoading ? (
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
        ) : (
          <BroadcastMasterDetail
            games={parsedGames}
            tourName={tour.name}
          />
        )}
      </Box>
    </Box>
  );
}

