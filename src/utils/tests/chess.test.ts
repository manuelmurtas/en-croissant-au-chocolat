import { expect, test } from "vitest";
import { ANNOTATION_INFO, type Annotation, NAG_INFO } from "../annotation";
import { getVariationLine, hasMorePriority } from "../chess";

test("NAGs are consistent", () => {
    for (const k of Object.keys(ANNOTATION_INFO)) {
        if (k === "") continue;
        const nag = ANNOTATION_INFO[k as Annotation].nag!;
        expect(NAG_INFO.get(`$${nag}`)).toBe(k);
    }
});

test("priority comparison", () => {
    expect(hasMorePriority([0, 0], [0])).toBe(false);
    expect(hasMorePriority([0], [0, 0])).toBe(true);
    expect(hasMorePriority([0], [1])).toBe(true);
    expect(hasMorePriority([1], [0])).toBe(false);
    expect(hasMorePriority([0, 0], [0, 1])).toBe(true);
    expect(hasMorePriority([0, 1], [0, 0])).toBe(false);
    expect(hasMorePriority([0, 1], [0, 2])).toBe(true);
    expect(hasMorePriority([0, 2], [0, 1])).toBe(false);
});

test("getVariationLine safely handles invalid/out-of-bounds positions without throwing", () => {
    const emptyNode = {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        children: [],
        annotations: [],
        halfMoves: 0,
    };
    expect(() => getVariationLine(emptyNode as any, [0, 0, 0, 5])).not.toThrow();
    expect(getVariationLine(emptyNode as any, [0, 0, 0, 5])).toEqual([]);
    expect(getVariationLine(emptyNode as any, [999])).toEqual([]);
});
