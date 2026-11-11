import type { Color } from "chessops";
import type { ScoreValue } from "@/bindings";
import { type Annotation } from "./annotation";
import { getWinChance, normalizeScore } from "./score";

export interface ClassifyMoveOptions {
  ply: number;
  movingColor: Color;
  prevScore: ScoreValue | null;
  currScore: ScoreValue | null;
  isBook?: boolean;
  prevOpponentWinChanceDiff?: number;
  isSacrifice?: boolean;
  existingAnnotation?: Annotation | null;
}

/**
 * Categorizes a chess move following Chess.com's Game Review model:
 * - 📖 Book Move: Standard opening theory within book depth and sound eval (Δ <= 3.5%)
 * - !! Brilliant: Sound piece sacrifice retaining advantage or huge turnaround (Δ < -12%)
 * - ! Great Move: Rare, crucial turning point or only move (Δ < -4% or high difficulty save)
 * - ★ Best Move: Engine top choice (0 loss in expected points, Δ <= 1.2%)
 * - ✓ Excellent: Near-best move (1.2% < Δ <= 2.8%)
 * - Good: Solid move (2.8% < Δ <= 5.5%), clean display without noisy badge
 * - ?! Inaccuracy: Noticeable slip (5.5% < Δ <= 11%)
 * - ? Mistake: Significant error (11% < Δ <= 21%)
 * - ⊗ Miss: Failed to punish opponent's previous blunder/mistake (opponent blunder + current Δ >= 10%)
 * - ?? Blunder: Decisive loss of win probability (Δ > 21%)
 */
export function classifyMove({
  ply,
  movingColor,
  prevScore,
  currScore,
  isBook,
  prevOpponentWinChanceDiff,
  isSacrifice,
  existingAnnotation,
}: ClassifyMoveOptions): {
  annotation: Annotation | null;
  winChanceDiff: number;
} {
  // If no evaluation is available at all:
  if (!currScore) {
    if (isBook || ply <= 4) {
      return { annotation: "📖", winChanceDiff: 0 };
    }
    return { annotation: existingAnnotation || null, winChanceDiff: 0 };
  }

  // Baseline if prevScore is not available (e.g. initial board position)
  const basePrevScore: ScoreValue = prevScore || { type: "cp", value: 15 };
  const prevCP = normalizeScore(basePrevScore, movingColor);
  const currCP = normalizeScore(currScore, movingColor);

  const prevWin = getWinChance(prevCP);
  const currWin = getWinChance(currCP);
  const winChanceDiff = prevWin - currWin; // Positive means moving player lost win chance

  // 1. Blunder (??): Dropped more than 21% win chance
  if (winChanceDiff > 21) {
    return { annotation: "??", winChanceDiff };
  }

  // 2. Miss (⊗) or Mistake (?): Dropped 11% to 21% win chance
  if (winChanceDiff > 11) {
    if (prevOpponentWinChanceDiff && prevOpponentWinChanceDiff >= 11) {
      return { annotation: "⊗", winChanceDiff };
    }
    return { annotation: "?", winChanceDiff };
  }

  // 3. Inaccuracy (?!): Dropped 5.5% to 11% win chance
  if (winChanceDiff > 5.5) {
    return { annotation: "?!", winChanceDiff };
  }

  // 4. Book Move (📖): If position is known opening theory and doesn't drop evaluation (> 3.5%)
  if (isBook && winChanceDiff <= 3.5) {
    return { annotation: "📖", winChanceDiff };
  }

  // 5. Brilliant (!!): Sound sacrifice retaining advantage or huge turnaround
  if (isSacrifice && winChanceDiff <= 1.5 && currCP >= -50) {
    return { annotation: "!!", winChanceDiff };
  }
  if (winChanceDiff < -12 && currCP >= -80) {
    return { annotation: "!!", winChanceDiff };
  }

  // 6. Great Move (!): Rare, crucial turning point or sharp saving move
  if (winChanceDiff < -4 && currCP >= -100) {
    return { annotation: "!", winChanceDiff };
  }
  if (existingAnnotation === "!" || existingAnnotation === "!!") {
    return { annotation: existingAnnotation, winChanceDiff };
  }

  // 7. Best Move (★): Engine #1 choice with virtually zero loss in expected points
  if (winChanceDiff <= 1.0) {
    return { annotation: "★", winChanceDiff };
  }

  // 8. Excellent (✓): Strict near-best threshold (1.0% to 1.8%) to let most solid moves remain badge-free
  if (winChanceDiff <= 1.8) {
    return { annotation: "✓", winChanceDiff };
  }

  // 9. Good Move: Solid (1.8% to 5.5%), clean display without noisy badge
  return { annotation: null, winChanceDiff };
}

/**
 * Returns the exact brand color matching Chess.com game review theme
 */
export function getReviewColor(annotation: Annotation | null | undefined): string {
  switch (annotation) {
    case "📖":
      return "#a0744b"; // Warm book brown
    case "★":
      return "#2b8a3e"; // Best move emerald green
    case "✓":
      return "#40c057"; // Excellent lime green
    case "!":
      return "#1971c2"; // Great move deep blue
    case "!!":
      return "#1098ad"; // Brilliant cyan
    case "?!":
      return "#f59f00"; // Inaccuracy yellow
    case "?":
      return "#f76707"; // Mistake orange
    case "??":
      return "#c92a2a"; // Blunder red
    case "⊗":
      return "#e03131"; // Miss crimson
    default:
      return "var(--mantine-color-dimmed)";
  }
}

