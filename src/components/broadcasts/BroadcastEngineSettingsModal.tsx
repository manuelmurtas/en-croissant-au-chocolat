import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconAlertCircle, IconCpu, IconExternalLink, IconSettings } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GoMode } from "@/bindings";
import GoModeInput from "@/components/common/GoModeInput";
import CoresSlider from "@/components/panels/analysis/CoresSlider";
import HashSlider from "@/components/panels/analysis/HashSlider";
import LinesSlider from "@/components/panels/analysis/LinesSlider";
import { type BroadcastEngineMode, enginesAtom } from "@/state/atoms";
import type { Engine, EngineSettings } from "@/utils/engines";

export type TabSettings = {
  enabled: boolean;
  settings: EngineSettings;
  go: GoMode;
  synced: boolean;
};

interface BroadcastEngineSettingsModalProps {
  opened: boolean;
  onClose: () => void;
  engineMode: BroadcastEngineMode;
  onModeChange: (mode: BroadcastEngineMode) => void;
  evalDepth: number;
  onEvalDepthChange: (depth: number) => void;
  engine?: Engine | null;
  settings: TabSettings;
  setSettings: (fn: (prev: TabSettings) => TabSettings) => void;
}

export default function BroadcastEngineSettingsModal({
  opened,
  onClose,
  engineMode,
  onModeChange,
  evalDepth,
  onEvalDepthChange,
  engine,
  settings,
  setSettings,
}: BroadcastEngineSettingsModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [engines, setEngines] = useAtom(enginesAtom);

  const threads = useMemo(() => {
    return settings.settings?.find((o) => o.name === "Threads");
  }, [settings.settings]);

  const hash = useMemo(() => {
    return settings.settings?.find((o) => o.name === "Hash");
  }, [settings.settings]);

  const multipv = useMemo(() => {
    return settings.settings?.find((o) => o.name === "MultiPV");
  }, [settings.settings]);

  const updateSetting = (name: string, value: string | number | boolean) => {
    setSettings((prev) => {
      const existing = prev.settings || [];
      const exists = existing.some((o) => o.name === name);
      const newSettings = exists
        ? existing.map((o) => (o.name === name ? { ...o, value } : o))
        : [...existing, { name, value }];
      return { ...prev, settings: newSettings };
    });
  };

  const saveAsGlobalDefault = () => {
    if (!engine) return;
    setEngines(async (prevEngines) => {
      const list = await prevEngines;
      return list.map((e) => {
        if (e.id === engine.id) {
          return {
            ...e,
            settings: settings.settings,
            go: settings.go,
          };
        }
        return e;
      });
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconCpu size={20} color="var(--mantine-color-teal-5)" />
          <Text fw={700} size="md">
            Broadcast Engine Settings {engine ? `(${engine.name})` : ""}
          </Text>
        </Group>
      }
      size="md"
      centered
    >
      <Stack gap="md">
        {!engine && (
          <Alert icon={<IconAlertCircle size={16} />} title="No engine loaded" color="orange">
            <Text size="xs" mb="xs">
              No chess engine is currently loaded. Please load or install Stockfish from the Engines
              tab.
            </Text>
            <Button
              size="xs"
              variant="light"
              color="orange"
              onClick={() => {
                onClose();
                navigate({ to: "/engines" });
              }}
            >
              Open Engines Page
            </Button>
          </Alert>
        )}

        {/* Engine Mode Section */}
        <Stack gap="xs">
          <Text size="sm" fw="bold">
            Analysis Mode
          </Text>
          <SegmentedControl
            fullWidth
            value={engineMode}
            onChange={(val) => onModeChange(val as BroadcastEngineMode)}
            data={[
              { label: "Off", value: "off" },
              { label: "Eval Bar Only", value: "eval-bar" },
              { label: "Full Analysis", value: "full" },
            ]}
          />
          <Text size="xs" c="dimmed">
            {engineMode === "off" &&
              "Engine calculation is off. Zero CPU load. Shows Lichess broadcast score if provided in PGN."}
            {engineMode === "eval-bar" &&
              "Eval Bar Only: Calculates 1 line up to max depth in the background. Continuously updates the Eval Bar without spoiling any move suggestions or arrows."}
            {engineMode === "full" &&
              "Full Analysis: Displays candidate moves, move evaluation bubbles, board threat/best move arrows, and full variations."}
          </Text>
        </Stack>

        {/* Depth / Search Limit Configuration */}
        {engineMode === "eval-bar" && (
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text size="sm" fw="bold">
                Maximum Engine Depth
              </Text>
              <Badge variant="light" color="teal">
                Depth {evalDepth}
              </Badge>
            </Group>
            <Group gap="xs">
              <Slider
                min={8}
                max={35}
                step={1}
                value={evalDepth}
                onChange={onEvalDepthChange}
                style={{ flex: 1 }}
                marks={[
                  { value: 12, label: "12" },
                  { value: 18, label: "18" },
                  { value: 24, label: "24" },
                  { value: 30, label: "30" },
                ]}
              />
              <NumberInput
                min={1}
                max={99}
                value={evalDepth}
                onChange={(v) => typeof v === "number" && onEvalDepthChange(v)}
                w={70}
                size="xs"
              />
            </Group>
            <Group gap={6} mt={4}>
              <Text size="xs" c="dimmed">
                Presets:
              </Text>
              {[12, 16, 18, 20, 24].map((d) => (
                <Button
                  key={d}
                  size="compact-xs"
                  variant={evalDepth === d ? "filled" : "light"}
                  color="teal"
                  onClick={() => onEvalDepthChange(d)}
                >
                  d{d}
                </Button>
              ))}
            </Group>
            <Text size="xs" c="dimmed">
              Depth 18 is recommended: finishes in ~1-2 seconds per move, uses minimal CPU, and provides
              stable evaluation without background overheating.
            </Text>
          </Stack>
        )}

        {engineMode === "full" && (
          <>
            <Stack gap="xs">
              <Text size="sm" fw="bold">
                Search Limit (Go Mode)
              </Text>
              <GoModeInput
                goMode={settings.go}
                setGoMode={(go) => setSettings((prev) => ({ ...prev, go }))}
              />
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw="bold">
                {t("Engines.Settings.NumOfLines")} (MultiPV)
              </Text>
              <LinesSlider
                value={Number(multipv?.value || 1)}
                setValue={(v) => updateSetting("MultiPV", v)}
              />
            </Stack>
          </>
        )}

        {/* Engine Hardware & Performance (Threads & Hash) */}
        {engine && engine.type === "local" && (
          <>
            <Divider my={4} label="Hardware & Resources" labelPosition="center" />

            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Box>
                  <Text size="sm" fw="bold">
                    {t("Engines.Settings.NumOfCores")} (Threads)
                  </Text>
                  <Text size="xs" c="dimmed">
                    CPU cores allocated to Stockfish
                  </Text>
                </Box>
                <CoresSlider
                  value={Number(threads?.value || 1)}
                  setValue={(v) => updateSetting("Threads", v)}
                />
              </Group>

              <Box mt="xs">
                <Text size="sm" fw="bold">
                  {t("Engines.Settings.SizeOfHash")} (Memory RAM)
                </Text>
                <Text size="xs" c="dimmed" mb={4}>
                  Transposition table size in MB
                </Text>
                <HashSlider
                  value={Number(hash?.value || 16)}
                  setValue={(v) => updateSetting("Hash", v)}
                />
              </Box>
            </Stack>
          </>
        )}

        {/* Footer actions */}
        <Divider my={4} />

        <Group justify="space-between" align="center">
          <Checkbox
            label={t("Board.Analysis.SyncGlobally")}
            checked={settings.synced}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setSettings((prev) => ({ ...prev, synced: checked }));
              if (checked) {
                saveAsGlobalDefault();
              }
            }}
          />

          <Button
            size="xs"
            variant="subtle"
            rightSection={<IconExternalLink size={14} />}
            onClick={() => {
              onClose();
              navigate({ to: "/engines" });
            }}
          >
            {t("Engines.Settings.AdvancedSettings")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

