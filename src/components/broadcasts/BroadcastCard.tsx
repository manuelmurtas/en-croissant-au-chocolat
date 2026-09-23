import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Image,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconCalendar,
  IconChess,
  IconLiveView,
  IconMapPin,
  IconUsers,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import type { BroadcastRound, BroadcastTour } from "@/utils/lichess/broadcast";
import classes from "./Broadcasts.module.css";

interface BroadcastCardProps {
  tour: BroadcastTour;
  round?: BroadcastRound;
  isLive?: boolean;
  onSelect: (tour: BroadcastTour) => void;
}

export default function BroadcastCard({
  tour,
  round,
  isLive,
  onSelect,
}: BroadcastCardProps) {
  const datesText = tour.dates
    ? `${dayjs(tour.dates[0]).format("MMM D")} - ${dayjs(tour.dates[1]).format("MMM D, YYYY")}`
    : null;

  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      className={classes.tourCard}
      onClick={() => onSelect(tour)}
    >
      <Card.Section>
        {tour.image ? (
          <Image
            src={tour.image}
            height={130}
            alt={tour.name}
            fallbackSrc="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='130' viewBox='0 0 100 130'%3E%3Crect fill='%23222' width='100' height='130'/%3E%3C/svg%3E"
          />
        ) : (
          <Box
            h={130}
            bg="dark.7"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconChess size={48} opacity={0.3} />
          </Box>
        )}
      </Card.Section>

      <Stack justify="space-between" mt="sm" style={{ flex: 1 }} gap="xs">
        <Stack gap={4}>
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Title order={5} lineClamp={2} title={tour.name}>
              {tour.name}
            </Title>
            {isLive ? (
              <Badge color="red" variant="filled" className={classes.liveBadge}>
                <span className={classes.pulseDot} />
                LIVE
              </Badge>
            ) : round?.finished ? (
              <Badge color="gray" variant="light">
                Finished
              </Badge>
            ) : (
              <Badge color="blue" variant="light">
                Upcoming
              </Badge>
            )}
          </Group>

          {tour.group && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {tour.group}
            </Text>
          )}

          {tour.info?.location && (
            <Group gap={4} mt={2}>
              <IconMapPin size={14} opacity={0.7} />
              <Text size="xs" c="dimmed" lineClamp={1}>
                {tour.info.location}
              </Text>
            </Group>
          )}

          {datesText && (
            <Group gap={4}>
              <IconCalendar size={14} opacity={0.7} />
              <Text size="xs" c="dimmed">
                {datesText}
              </Text>
            </Group>
          )}

          {tour.info?.players && (
            <Group gap={4} align="flex-start">
              <IconUsers size={14} opacity={0.7} style={{ marginTop: 2 }} />
              <Text size="xs" c="dimmed" lineClamp={1}>
                {tour.info.players}
              </Text>
            </Group>
          )}
        </Stack>

        <Group justify="space-between" align="center" mt="xs">
          {round?.name ? (
            <Text size="xs" fw={500} c={isLive ? "red" : "dimmed"}>
              {round.name} {round.ongoing ? "• In Progress" : ""}
            </Text>
          ) : (
            <Box />
          )}

          <Button
            size="xs"
            variant={isLive ? "filled" : "light"}
            color={isLive ? "red" : "blue"}
            leftSection={<IconLiveView size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(tour);
            }}
          >
            {isLive ? "Watch Live" : "View"}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

