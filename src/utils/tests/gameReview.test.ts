import { describe, expect, it } from "vitest";
import { classifyMove, getReviewColor } from "../gameReview";

describe("Chess.com Game Review move classification", () => {
  it("should classify standard opening moves in book as Book (📖)", () => {
    const res = classifyMove({
      ply: 1,
      movingColor: "white",
      prevScore: { type: "cp", value: 15 },
      currScore: { type: "cp", value: 30 },
      isBook: true,
    });
    expect(res.annotation).toBe("📖");
  });

  it("should not classify an opening blunder as Book even if isBook is true", () => {
    const res = classifyMove({
      ply: 2,
      movingColor: "white",
      prevScore: { type: "cp", value: 20 },
      currScore: { type: "cp", value: -500 },
      isBook: true,
    });
    expect(res.annotation).toBe("??");
  });

  it("should classify engine top move as Best (★) when outside book", () => {
    const res = classifyMove({
      ply: 20,
      movingColor: "white",
      prevScore: { type: "cp", value: 100 },
      currScore: { type: "cp", value: 100 },
      isBook: false,
    });
    expect(res.annotation).toBe("★");
    expect(getReviewColor(res.annotation)).toBe("#2b8a3e");
  });

  it("should classify near-best move as Excellent (✓)", () => {
    const res = classifyMove({
      ply: 20,
      movingColor: "white",
      prevScore: { type: "cp", value: 100 },
      currScore: { type: "cp", value: 85 }, // small drop ~ 1.34%
      isBook: false,
    });
    expect(res.annotation).toBe("✓");
    expect(getReviewColor(res.annotation)).toBe("#40c057");
  });

  it("should classify moves with slight drops (e.g. 25cp) as Good (null badge)", () => {
    const res = classifyMove({
      ply: 20,
      movingColor: "white",
      prevScore: { type: "cp", value: 100 },
      currScore: { type: "cp", value: 75 }, // slight drop ~ 2.3% -> clean null badge instead of Excellent
      isBook: false,
    });
    expect(res.annotation).toBeNull();
  });

  it("should classify solid moves as Good (clean null annotation)", () => {
    const res = classifyMove({
      ply: 20,
      movingColor: "white",
      prevScore: { type: "cp", value: 100 },
      currScore: { type: "cp", value: 65 }, // moderate drop ~ 3.5%
      isBook: false,
    });
    expect(res.annotation).toBeNull();
  });

  it("should classify noticeable drops as Inaccuracy (?!)", () => {
    const res = classifyMove({
      ply: 20,
      movingColor: "white",
      prevScore: { type: "cp", value: 100 },
      currScore: { type: "cp", value: 20 }, // ~ 8% drop
      isBook: false,
    });
    expect(res.annotation).toBe("?!");
  });

  it("should classify significant drops as Mistake (?)", () => {
    const res = classifyMove({
      ply: 20,
      movingColor: "white",
      prevScore: { type: "cp", value: 100 },
      currScore: { type: "cp", value: -60 }, // ~ 16% drop
      isBook: false,
    });
    expect(res.annotation).toBe("?");
  });

  it("should classify missed punishment after opponent blunder as Miss (⊗)", () => {
    const res = classifyMove({
      ply: 21,
      movingColor: "black",
      prevScore: { type: "cp", value: -200 }, // opponent just blundered into black advantage
      currScore: { type: "cp", value: 0 }, // black failed to punish and dropped advantage
      prevOpponentWinChanceDiff: 25,
      isBook: false,
    });
    expect(res.annotation).toBe("⊗");
    expect(getReviewColor(res.annotation)).toBe("#e03131");
  });

  it("should classify severe drop as Blunder (??)", () => {
    const res = classifyMove({
      ply: 20,
      movingColor: "white",
      prevScore: { type: "cp", value: 100 },
      currScore: { type: "cp", value: -250 }, // ~ 35% drop
      isBook: false,
    });
    expect(res.annotation).toBe("??");
  });

  it("should classify sound sacrifice as Brilliant (!!)", () => {
    const res = classifyMove({
      ply: 25,
      movingColor: "white",
      prevScore: { type: "cp", value: 150 },
      currScore: { type: "cp", value: 160 },
      isSacrifice: true,
      isBook: false,
    });
    expect(res.annotation).toBe("!!");
    expect(getReviewColor(res.annotation)).toBe("#1098ad");
  });

  it("should classify sharp turning point as Great Move (!)", () => {
    const res = classifyMove({
      ply: 30,
      movingColor: "white",
      prevScore: { type: "cp", value: 0 },
      currScore: { type: "cp", value: 120 }, // finds sharp path gaining win probability
      isBook: false,
    });
    expect(res.annotation).toBe("!");
    expect(getReviewColor(res.annotation)).toBe("#1971c2");
  });
});

