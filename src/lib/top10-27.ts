// Top 10 hands in 2-7 lowball, ranks sorted descending.
export const TOP_10_27: number[][] = [
  [7, 5, 4, 3, 2], // #1
  [7, 6, 4, 3, 2], // #2
  [7, 6, 5, 3, 2], // #3
  [7, 6, 5, 4, 2], // #4
  [8, 5, 4, 3, 2], // #5
  [8, 6, 4, 3, 2], // #6
  [8, 6, 5, 3, 2], // #7
  [8, 6, 5, 4, 2], // #8
  [8, 6, 5, 4, 3], // #9
  [8, 7, 4, 3, 2], // #10
];

/** Returns 1-based ranking (1–10) or -1 if not in top 10. */
export function findTop10Rank(sortedRanksDesc: number[]): number {
  const idx = TOP_10_27.findIndex((top) =>
    top.length === sortedRanksDesc.length &&
    top.every((r, i) => r === sortedRanksDesc[i])
  );
  return idx === -1 ? -1 : idx + 1;
}
