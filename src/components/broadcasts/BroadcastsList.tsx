import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBroadcast,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  type BroadcastTour,
  fetchAndComputeRoundRating,
  fetchTopBroadcasts,
  roundAvgRatingCache,
} from "@/utils/lichess/broadcast";
import BroadcastCard from "./BroadcastCard";
import classes from "./Broadcasts.module.css";

interface BroadcastsListProps {
  onSelectTour: (tour: BroadcastTour) => void;
}

export default function BroadcastsList({ onSelectTour }: BroadcastsListProps) {
  const [activeTab, setActiveTab] = useState<string>("live");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"rating" | "default">("rating");
  const [ratingsMap, setRatingsMap] = useState<Record<string, number>>({});

  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR("lichess-top-broadcasts", fetchTopBroadcasts, {
    revalidateOnFocus: false,
    refreshInterval: 60000, // refresh list once a minute
  });

  const activeItems = useMemo(() => data?.active || [], [data]);
  const pastItems = useMemo(() => data?.past || [], [data]);
  const upcomingItems = useMemo(() => data?.upcoming || [], [data]);

  // "Live Now" = items where the round is explicitly ongoing
  const liveItems = useMemo(() => {
    return activeItems.filter(
      (item) => item.round?.ongoing || (item.rounds && item.rounds.some((r) => r.ongoing)),
    );
  }, [activeItems]);

  const currentTabItems = useMemo(() => {
    switch (activeTab) {
      case "live":
        return liveItems.length > 0 ? liveItems : activeItems;
      case "all":
        return [...activeItems, ...upcomingItems];
      case "past":
        return pastItems;
      default:
        return activeItems;
    }
  }, [activeTab, liveItems, activeItems, upcomingItems, pastItems]);

  // Fetch average rating for each tournament's current/live round
  useEffect(() => {
    let cancelled = false;

    const itemsToProcess = currentTabItems
      .map((item) => {
        const ongoingRound = item.round?.ongoing
          ? item.round
          : item.rounds?.find((r) => r.ongoing);
        const roundId = ongoingRound?.id || item.round?.id || item.defaultRoundId;
        return { tourId: item.tour.id, roundId };
      })
      .filter((x): x is { tourId: string; roundId: string } => !!x.roundId);

    // Populate immediately from cache if available
    const cached: Record<string, number> = {};
    for (const { tourId, roundId } of itemsToProcess) {
      if (roundAvgRatingCache.has(roundId)) {
        cached[tourId] = roundAvgRatingCache.get(roundId)!;
      }
    }
    if (Object.keys(cached).length > 0) {
      setRatingsMap((prev) => {
        let changed = false;
        for (const [k, v] of Object.entries(cached)) {
          if (prev[k] !== v) {
            changed = true;
            break;
          }
        }
        return changed ? { ...prev, ...cached } : prev;
      });
    }

    const needed = itemsToProcess.filter(({ roundId }) => !roundAvgRatingCache.has(roundId));
    if (needed.length === 0) return;

    Promise.all(
      needed.map(async ({ tourId, roundId }) => {
        const rating = await fetchAndComputeRoundRating(roundId);
        return { tourId, rating };
      }),
    ).then((results) => {
      if (cancelled) return;
      setRatingsMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const { tourId, rating } of results) {
          if (rating !== null && prev[tourId] !== rating) {
            next[tourId] = rating;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [currentTabItems]);

  const sortedAndFilteredItems = useMemo(() => {
    let items = currentTabItems;
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((item) => {
        const name = item.tour.name.toLowerCase();
        const group = (item.tour.group || "").toLowerCase();
        const loc = (item.tour.info?.location || "").toLowerCase();
        const players = (item.tour.info?.players || "").toLowerCase();
        return name.includes(q) || group.includes(q) || loc.includes(q) || players.includes(q);
      });
    }

    // Always sort by Average Rating descending when on Live tab or when sortBy is 'rating'
    if (sortBy === "rating" || activeTab === "live") {
      return [...items].sort((a, b) => {
        const ratingA = ratingsMap[a.tour.id] || 0;
        const ratingB = ratingsMap[b.tour.id] || 0;
        if (ratingA !== ratingB) {
          return ratingB - ratingA;
        }
        const tierA = a.tour.tier || 0;
        const tierB = b.tour.tier || 0;
        if (tierA !== tierB) {
          return tierB - tierA;
        }
        return a.tour.name.localeCompare(b.tour.name);
      });
    }

    return items;
  }, [currentTabItems, search, sortBy, activeTab, ratingsMap]);

  return (
    <Container size="xl" py="lg" style={{ height: "100%", overflowY: "auto" }}>
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs">
            <IconBroadcast size={28} color="var(--mantine-color-blue-5)" />
            <Title order={2}>Live Chess Broadcasts</Title>
            {liveItems.length > 0 && (
              <Badge color="red" variant="filled" className={classes.liveBadge}>
                <span className={classes.pulseDot} />
                {liveItems.length} LIVE
              </Badge>
            )}
          </Group>

          <Group gap="xs" wrap="wrap">
            <TextInput
              placeholder="Search tournaments or players..."
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              size="sm"
              w={{ base: "100%", sm: 220 }}
            />
            <Select
              size="sm"
              w={{ base: "100%", sm: 210 }}
              value={sortBy}
              onChange={(val) => setSortBy((val as "rating" | "default") || "rating")}
              data={[
                { label: "⭐ Rating (High to Low)", value: "rating" },
                { label: "Default Order", value: "default" },
              ]}
            />
            <ActionIcon
              variant="default"
              size="input-sm"
              onClick={() => mutate()}
              loading={isValidating}
              title="Refresh broadcasts list"
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {/* Tabs */}
        <Tabs value={activeTab} onChange={(val) => setActiveTab(val || "live")}>
          <Tabs.List>
            <Tabs.Tab
              value="live"
              leftSection={
                <span
                  className={liveItems.length > 0 ? classes.pulseDot : undefined}
                  style={
                    liveItems.length === 0
                      ? {
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          backgroundColor: "var(--mantine-color-gray-6)",
                        }
                      : undefined
                  }
                />
              }
            >
              Live Now ({liveItems.length > 0 ? liveItems.length : activeItems.length})
            </Tabs.Tab>
            <Tabs.Tab value="all">
              Top Tournaments ({activeItems.length + upcomingItems.length})
            </Tabs.Tab>
            <Tabs.Tab value="past">Past Events ({pastItems.length})</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {/* Error message */}
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Unable to load broadcasts"
            color="red"
            variant="light"
          >
            {error.message || "Failed to communicate with Lichess Broadcast API."}
            <Button size="xs" variant="outline" color="red" ml="md" onClick={() => mutate()}>
              Retry
            </Button>
          </Alert>
        )}

        {/* Loading skeletons */}
        {isLoading && (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
            {Array.from({ length: 8 }).map((_, i) => (
              <Box key={i} p="sm">
                <Skeleton height={130} radius="md" mb="sm" />
                <Skeleton height={20} radius="sm" mb="xs" />
                <Skeleton height={14} radius="sm" width="70%" mb="xs" />
                <Skeleton height={14} radius="sm" width="50%" />
              </Box>
            ))}
          </SimpleGrid>
        )}

        {/* Tournament Cards Grid */}
        {!isLoading && sortedAndFilteredItems.length > 0 && (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
            {sortedAndFilteredItems.map((item) => {
              const isOngoing =
                item.round?.ongoing || (item.rounds && item.rounds.some((r) => r.ongoing));
              return (
                <BroadcastCard
                  key={item.tour.id}
                  tour={item.tour}
                  round={item.round}
                  isLive={isOngoing}
                  avgRating={ratingsMap[item.tour.id] || null}
                  onSelect={onSelectTour}
                />
              );
            })}
          </SimpleGrid>
        )}

        {/* Empty state */}
        {!isLoading && sortedAndFilteredItems.length === 0 && !error && (
          <Stack align="center" justify="center" py="xl" gap="sm">
            <IconBroadcast size={48} opacity={0.3} />
            <Text c="dimmed">No broadcasts found matching your criteria.</Text>
            {search && (
              <Button size="xs" variant="subtle" onClick={() => setSearch("")}>
                Clear search
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}

