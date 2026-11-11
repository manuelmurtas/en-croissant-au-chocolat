import { Progress } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

type ProgressPayload = {
  id: string;
  progress: number;
  finished: boolean;
};

function DatabaseLoader({ isLoading, tab }: { isLoading: boolean; tab: string | null }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<ProgressPayload>("search_progress", ({ payload }) => {
      if (payload.id !== tab) return;
      if (payload.finished) {
        setProgress(0);
      } else {
        setProgress(payload.progress);
      }
    }).then((cleanup) => {
      if (cancelled) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [tab]);

  const isLoadingFromMemory = isLoading && progress === 0;

  return (
    <Progress
      animated={isLoadingFromMemory}
      value={isLoadingFromMemory ? 100 : progress}
      size="xs"
      mt="xs"
    />
  );
}

export default DatabaseLoader;
