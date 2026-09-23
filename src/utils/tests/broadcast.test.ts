import { describe, expect, it } from "vitest";
import { parseBroadcastGames } from "../lichess/broadcast";

const SAMPLE_PGN = `
[Event "Olymp 2026 Women"]
[Site "Sarmarkand, Uzbekistan"]
[Date "2026.09.23"]
[Round "7.195"]
[White "Nasra Kamal Ibrahim"]
[Black "Kangalee, Kennedi"]
[Result "1-0"]
[WhiteElo "1500"]
[BlackElo "1600"]
[WhiteTeam "Comoros Islands"]
[BlackTeam "Saint Kitts and Nevis"]
[ECO "B12"]
[Opening "Caro-Kann Defense"]
[GameURL "https://lichess.org/broadcast/test/round-7/q8uYTw2W"]

1. e4 { [%eval 0.18] [%clk 1:30:58] } 1... c6 { [%eval 0.31] [%clk 1:30:52] } 2. d4 1-0

[Event "Olymp 2026 Women"]
[Site "Sarmarkand, Uzbekistan"]
[Date "2026.09.23"]
[Round "7.196"]
[White "Fyfield-Jones, Kaellaa"]
[Black "Ahmed Houmairaou"]
[Result "0-1"]
[WhiteElo "1700"]
[BlackElo "1800"]
[WhiteTeam "Saint Kitts and Nevis"]
[BlackTeam "Comoros Islands"]
[ECO "C55"]
[Opening "Italian Game"]
[GameURL "https://lichess.org/broadcast/test/round-7/4RTEPWeJ"]

1. e4 { [%eval 0.18] [%clk 1:30:57] } 1... e5 { [%eval -0.22] [%clk 1:30:54] } 0-1
`;

describe("parseBroadcastGames", () => {
  it("correctly parses multi-game broadcast PGN", () => {
    const games = parseBroadcastGames(SAMPLE_PGN);
    expect(games).toHaveLength(2);

    expect(games[0].id).toBe("q8uYTw2W");
    expect(games[0].boardNumber).toBe(195);
    expect(games[0].white).toBe("Nasra Kamal Ibrahim");
    expect(games[0].black).toBe("Kangalee, Kennedi");
    expect(games[0].result).toBe("1-0");
    expect(games[0].whiteElo).toBe("1500");
    expect(games[0].blackElo).toBe("1600");
    expect(games[0].whiteTeam).toBe("Comoros Islands");
    expect(games[0].eco).toBe("B12");
    expect(games[0].eval).toBe("0.31");

    expect(games[1].id).toBe("4RTEPWeJ");
    expect(games[1].boardNumber).toBe(196);
    expect(games[1].white).toBe("Fyfield-Jones, Kaellaa");
    expect(games[1].result).toBe("0-1");
  });
});

