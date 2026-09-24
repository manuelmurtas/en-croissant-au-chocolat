import { createFileRoute } from "@tanstack/react-router";
import PipGameView from "@/components/broadcasts/PipGameView";

export const Route = createFileRoute("/pip")({
  component: PipGameView,
});
