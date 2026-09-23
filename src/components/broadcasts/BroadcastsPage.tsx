import { Box } from "@mantine/core";
import { useState } from "react";
import type { BroadcastTour } from "@/utils/lichess/broadcast";
import BroadcastsList from "./BroadcastsList";
import BroadcastTourView from "./BroadcastTourView";

export default function BroadcastsPage() {
  const [selectedTour, setSelectedTour] = useState<BroadcastTour | null>(null);

  return (
    <Box h="100%" style={{ overflow: "hidden" }}>
      {selectedTour ? (
        <BroadcastTourView
          tour={selectedTour}
          onBack={() => setSelectedTour(null)}
        />
      ) : (
        <BroadcastsList onSelectTour={setSelectedTour} />
      )}
    </Box>
  );
}

