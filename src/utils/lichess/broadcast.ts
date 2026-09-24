import { fetch } from "@tauri-apps/plugin-http";
import { apiHeaders } from "@/utils/http";

const LICHESS_BASE = "https://lichess.org/api";

export interface BroadcastTourInfo {
  format?: string;
  tc?: string;
  fideTC?: string;
  location?: string;
  timeZone?: string;
  players?: string;
  website?: string;
  standings?: string;
  regulations?: string;
}

export interface BroadcastTour {
  id: string;
  name: string;
  slug: string;
  info?: BroadcastTourInfo;
  createdAt?: number;
  url: string;
  tier?: number;
  dates?: [number, number];
  image?: string;
  teamTable?: boolean;
  showTeamScores?: boolean;
  group?: string;
}

export interface BroadcastRound {
  id: string;
  name: string;
  slug: string;
  ongoing?: boolean;
  finished?: boolean;
  startsAt?: number;
  finishedAt?: number;
  url: string;
}

export interface BroadcastItem {
  tour: BroadcastTour;
  round?: BroadcastRound;
  rounds?: BroadcastRound[];
  defaultRoundId?: string;
  group?: string;
}

export interface BroadcastTopResponse {
  active: BroadcastItem[];
  past: BroadcastItem[];
  upcoming: BroadcastItem[];
}

export interface BroadcastTourDetail {
  tour: BroadcastTour;
  rounds: BroadcastRound[];
  defaultRoundId?: string;
  group?: string;
  photos?: Record<string, { small?: string; medium?: string; credit?: string }>;
}

export interface BroadcastGameSummary {
  id: string;
  roundName: string;
  boardNumber: number;
  white: string;
  black: string;
  whiteElo?: string;
  blackElo?: string;
  whiteTitle?: string;
  blackTitle?: string;
  whiteTeam?: string;
  blackTeam?: string;
  whiteFideId?: string;
  blackFideId?: string;
  result: string;
  eco?: string;
  opening?: string;
  eval?: string;
  whiteClk?: string;
  blackClk?: string;
  lastMove?: string;
  pgn: string;
}

export async function fetchTopBroadcasts(): Promise<BroadcastTopResponse> {
  const res = await fetch(`${LICHESS_BASE}/broadcast/top`, {
    headers: apiHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch top broadcasts: ${res.statusText}`);
  }
  return (await res.json()) as BroadcastTopResponse;
}

export async function fetchTourDetail(tourId: string): Promise<BroadcastTourDetail> {
  const res = await fetch(`${LICHESS_BASE}/broadcast/${tourId}`, {
    headers: apiHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch tour detail: ${res.statusText}`);
  }
  return (await res.json()) as BroadcastTourDetail;
}

export async function fetchRoundPgn(roundId: string): Promise<string> {
  const res = await fetch(`${LICHESS_BASE}/broadcast/round/${roundId}.pgn`, {
    headers: apiHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch round PGN: ${res.statusText}`);
  }
  return await res.text();
}

function extractHeader(pgn: string, header: string): string | undefined {
  const regex = new RegExp(`\\[${header}\\s+"([^"]*)"\\]`, "i");
  const match = pgn.match(regex);
  return match ? match[1] : undefined;
}

export function parseBroadcastGames(rawPgnText: string): BroadcastGameSummary[] {
  if (!rawPgnText || !rawPgnText.trim()) return [];

  // Split on game boundaries: multiple newlines followed by [Event
  const rawGames = rawPgnText
    .split(/(?:\r?\n){2,}(?=\[Event )/g)
    .map((g) => g.trim())
    .filter((g) => g.startsWith("[Event "));

  return rawGames.map((gamePgn, index) => {
    const roundTag = extractHeader(gamePgn, "Round") || "";
    // e.g. "7.1", "7.24" -> board number 1, 24
    let boardNumber = index + 1;
    if (roundTag.includes(".")) {
      const parts = roundTag.split(".");
      const parsedBoard = parseInt(parts[1], 10);
      if (!isNaN(parsedBoard)) {
        boardNumber = parsedBoard;
      }
    }

    const white = extractHeader(gamePgn, "White") || "White";
    const black = extractHeader(gamePgn, "Black") || "Black";
    const whiteElo = extractHeader(gamePgn, "WhiteElo");
    const blackElo = extractHeader(gamePgn, "BlackElo");
    const whiteTitle = extractHeader(gamePgn, "WhiteTitle");
    const blackTitle = extractHeader(gamePgn, "BlackTitle");
    const whiteTeam = extractHeader(gamePgn, "WhiteTeam");
    const blackTeam = extractHeader(gamePgn, "BlackTeam");
    const whiteFideId = extractHeader(gamePgn, "WhiteFideId");
    const blackFideId = extractHeader(gamePgn, "BlackFideId");
    const result = extractHeader(gamePgn, "Result") || "*";
    const eco = extractHeader(gamePgn, "ECO");
    const opening = extractHeader(gamePgn, "Opening");
    const gameUrl = extractHeader(gamePgn, "GameURL");

    // Generate unique ID from URL or fallback
    let id = `${index}`;
    if (gameUrl) {
      const match = gameUrl.match(/\/([a-zA-Z0-9]+)$/);
      if (match) id = match[1];
    } else {
      id = `${boardNumber}-${white.replace(/\s+/g, "")}-${black.replace(/\s+/g, "")}`;
    }

    // Extract latest evaluation [%eval ...]
    let lastEval: string | undefined;
    const evalMatches = [...gamePgn.matchAll(/\[%eval\s+([^\]]+)\]/g)];
    if (evalMatches.length > 0) {
      lastEval = evalMatches[evalMatches.length - 1][1];
    }

    // Extract latest clocks [%clk ...]
    // Clocks alternate White and Black: find all moves with clock tags
    let whiteClk: string | undefined;
    let blackClk: string | undefined;
    const clkMatches = [...gamePgn.matchAll(/\[%clk\s+([^\]]+)\]/g)];
    if (clkMatches.length > 0) {
      // If odd number of moves with clk, the last one was White's move
      // If even, the last one was Black's move
      if (clkMatches.length % 2 === 1) {
        whiteClk = clkMatches[clkMatches.length - 1][1];
        if (clkMatches.length > 1) {
          blackClk = clkMatches[clkMatches.length - 2][1];
        }
      } else {
        blackClk = clkMatches[clkMatches.length - 1][1];
        whiteClk = clkMatches[clkMatches.length - 2][1];
      }
    }

    // Extract last move text (e.g. 34... Rf1# or 31. Bd5)
    // Find text after headers
    const movesPart = gamePgn.replace(/\[[^\]]*\]\s*/g, "").trim();
    let lastMove: string | undefined;
    if (movesPart) {
      // Clean comments and outcomes
      const cleaned = movesPart
        .replace(/\{[^}]*\}/g, "")
        .replace(/1-0|0-1|1\/2-1\/2|\*/g, "")
        .trim();
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        lastMove = tokens[tokens.length - 1];
        // If it's a move number like "1.", grab the next token if available
        if (/^\d+\.?$/.test(lastMove) && tokens.length > 1) {
          lastMove = tokens[tokens.length - 2] + " " + lastMove;
        }
      }
    }

    return {
      id,
      roundName: roundTag,
      boardNumber,
      white,
      black,
      whiteElo,
      blackElo,
      whiteTitle,
      blackTitle,
      whiteTeam,
      blackTeam,
      whiteFideId,
      blackFideId,
      result,
      eco,
      opening,
      eval: lastEval,
      whiteClk,
      blackClk,
      lastMove,
      pgn: gamePgn,
    };
  });
}
