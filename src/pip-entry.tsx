import { Component, type ReactNode } from "react";
import { createTheme, MantineProvider } from "@mantine/core";
import { useAtomValue } from "jotai";
import { createRoot } from "react-dom/client";
import PipGameView from "@/components/broadcasts/PipGameView";
import { pieceSetAtom } from "@/state/atoms";

import "@mantine/core/styles.css";
import "@/styles/chessgroundBaseOverride.css";
import "@/styles/chessgroundColorsOverride.css";
import "@/styles/global.css";

window.addEventListener("error", (e) => {
  console.error("Pip window error:", e.error || e.message);
  const el = document.getElementById("pip-app");
  if (el && !el.hasChildNodes()) {
    el.innerHTML = `<div style="color:#ff6b6b;padding:12px;font-family:sans-serif;font-size:12px;"><b>Error loading Mini Player</b><pre style="white-space:pre-wrap;font-size:10px;">${e.message}\n${e.error?.stack || ""}</pre></div>`;
  }
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: "#ff6b6b", padding: 12, fontFamily: "sans-serif", fontSize: 12 }}>
          <b>Mini Player Error:</b>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 10 }}>{(this.state.error as Error).message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const theme = createTheme({
  primaryColor: "blue",
  colors: {
    dark: [
      "#C1C2C5",
      "#A6A7AB",
      "#909296",
      "#5c5f66",
      "#373A40",
      "#2C2E33",
      "#25262b",
      "#1A1B1E",
      "#141517",
      "#101113",
    ],
  },
});

function PipRoot() {
  const pieceSet = useAtomValue(pieceSetAtom);

  return (
    <ErrorBoundary>
      <link rel="stylesheet" href={`/pieces/${pieceSet}.css`} />
      <MantineProvider defaultColorScheme="dark" theme={theme}>
        <PipGameView />
      </MantineProvider>
    </ErrorBoundary>
  );
}

const container = document.getElementById("pip-app");
if (container) {
  const root = createRoot(container);
  root.render(<PipRoot />);
}
