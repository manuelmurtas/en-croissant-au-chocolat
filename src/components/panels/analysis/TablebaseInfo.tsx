import { Accordion, Badge, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { parseUci } from "chessops";
import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWRImmutable from "swr/immutable";
import { match, P } from "ts-pattern";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { getTablebaseInfo, type TablebaseCategory } from "@/utils/lichess/api";
import classes from "./TablebaseInfo.module.css";

interface TablebaseInfoProps {
  fen: string;
  turn: "white" | "black";
  defaultOpened?: boolean;
}

function TablebaseInfo({ fen, turn, defaultOpened = false }: TablebaseInfoProps) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const makeMove = useStore(store, (s) => s.makeMove);
  const { data, error, isLoading } = useSWRImmutable(
    ["tablebase", fen],
    async ([_, fen]) => await getTablebaseInfo(fen),
  );

  const sortedMoves = useMemo(() => {
    if (!data?.moves) return [];
    return [...data.moves].sort((a, b) => {
      const categoryRank = (cat: TablebaseCategory): number => {
        switch (cat) {
          case "win":
            return 0;
          case "maybe-win":
          case "cursed-win":
            return 1;
          case "draw":
            return 2;
          case "blessed-loss":
          case "maybe-loss":
            return 3;
          case "loss":
            return 4;
          default:
            return 5;
        }
      };

      const rankDiff = categoryRank(a.category) - categoryRank(b.category);
      if (rankDiff !== 0) return rankDiff;

      // Within same category, sort by DTM
      if (a.dtm && b.dtm) {
        if (a.category === "win") return Math.abs(a.dtm) - Math.abs(b.dtm); // Faster win first
        if (a.category === "loss") return Math.abs(b.dtm) - Math.abs(a.dtm); // Delaying loss first
      }
      return 0;
    });
  }, [data?.moves]);

  return (
    <Paper withBorder radius="sm">
      <Accordion
        defaultValue={defaultOpened ? "tablebase" : undefined}
        styles={{
          label: {
            padding: "0.4rem 0.5rem",
          },
          control: {
            padding: "0.25rem 0.5rem",
          },
          content: {
            padding: "0.25rem 0.5rem 0.5rem 0.5rem",
          },
        }}
      >
        <Accordion.Item value="tablebase">
          <Accordion.Control>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Group gap="xs" wrap="nowrap">
                <Text fw="bold" size="sm">
                  {t("Board.Analysis.Tablebase")}
                </Text>
                {isLoading && (
                  <Badge size="xs" variant="transparent">
                    {t("Common.Loading")}
                  </Badge>
                )}
                {error && (
                  <Text size="xs" c="red">
                    {t("Common.Error")}
                  </Text>
                )}
              </Group>
              {data && (
                <OutcomeBadge
                  category={data.category}
                  turn={turn}
                  wins
                  dtm={data.dtm}
                  dtz={data.dtz}
                />
              )}
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {data && (
              <Stack gap="xs">
                <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
                  {sortedMoves.map((m) => (
                    <Paper
                      withBorder
                      key={m.san}
                      px="xs"
                      py={2}
                      onClick={() => {
                        const parsed = parseUci(m.uci);
                        if (parsed) {
                          makeMove({ payload: parsed });
                        }
                      }}
                      className={classes.info}
                    >
                      <Group gap="xs" justify="space-between" wrap="nowrap">
                        <Text fz="0.85rem" fw={600} ta="center">
                          {m.san}
                        </Text>
                        <OutcomeBadge
                          category={m.category}
                          dtz={Math.abs(m.dtz)}
                          dtm={m.dtm}
                          turn={turn === "white" ? "black" : "white"}
                        />
                      </Group>
                    </Paper>
                  ))}
                </SimpleGrid>
              </Stack>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Paper>
  );
}

function OutcomeBadge({
  category,
  turn,
  wins,
  dtz,
  dtm,
}: {
  category: TablebaseCategory;
  turn: "white" | "black";
  wins?: boolean;
  dtz?: number;
  dtm?: number;
}) {
  const { t } = useTranslation();
  const normalizedCategory = match(category)
    .with("win", () =>
      turn === "white"
        ? t("Board.Analysis.Tablebase.WhiteWins")
        : t("Board.Analysis.Tablebase.BlackWins"),
    )
    .with("loss", () =>
      turn === "white"
        ? t("Board.Analysis.Tablebase.BlackWins")
        : t("Board.Analysis.Tablebase.WhiteWins"),
    )
    .with(P.union("draw", "blessed-loss", "cursed-win"), () => t("Board.Analysis.Tablebase.Draw"))
    .with(P.union("unknown", "maybe-win", "maybe-loss"), () => t("Common.Unknown"))
    .exhaustive();

  const color = wins
    ? match(category)
        .with("win", () => (turn === "white" ? "teal" : "dark"))
        .with("loss", () => (turn === "white" ? "dark" : "teal"))
        .otherwise(() => "gray")
    : match(category)
        .with("win", () => "teal")
        .with("loss", () => "red")
        .otherwise(() => "gray");

  const label = wins
    ? dtm && Math.abs(dtm) > 0
      ? `${normalizedCategory} (DTM ${Math.abs(dtm)})`
      : normalizedCategory
    : match(category)
        .with("draw", () => t("Board.Analysis.Tablebase.Draw"))
        .with("unknown", () => t("Common.Unknown"))
        .otherwise(() => (dtm ? `DTM ${dtm > 0 ? `+${dtm}` : dtm}` : `DTZ ${dtz}`));

  return (
    <Group p={2} gap={4} wrap="nowrap">
      <Badge autoContrast color={color} size={wins ? "sm" : "xs"}>
        {label}
      </Badge>
      {["blessed-loss", "cursed-win", "maybe-win", "maybe-loss"].includes(category) && wins && (
        <Text c="dimmed" fz="xs">
          {t("Board.Analysis.Tablebase.FiftyMoveRule")}
        </Text>
      )}
    </Group>
  );
}

export default TablebaseInfo;
