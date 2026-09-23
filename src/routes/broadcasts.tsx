import { createFileRoute } from "@tanstack/react-router";
import BroadcastsPage from "@/components/broadcasts/BroadcastsPage";

export const Route = createFileRoute("/broadcasts")({
  component: BroadcastsPage,
});

