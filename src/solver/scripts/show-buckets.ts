// Script: show all 30 buckets with best and worst hand in each bucket.
// Enumerates all C(52,5) = 2,598,960 hands exactly.

import { Rank, Suit } from "@/engine/cards";
import { handToBucket, initBuckets, NUM_BUCKETS, bucketLabel } from "@/solver/abstraction/handBuckets";
import type { Card } from "@/engine/cards";

initBuckets(500_000);

const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14] as Rank[];
const SUITS = ["c","d","h","s"] as Suit[];

const deck: Card[] = [];
for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });

// Replicate scoring logic to track best/worst within bucket
function isConsecutive(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i-1]+1) return false;
  return true;
}
function allSameSuit(cards: Card[]): boolean {
  return cards.every(c => c.suit === cards[0].suit);
}

function handScore(hand: Card[]): { drawCount: number; score: number } {
  const seenRanks = new Set<number>();
  const kept: Card[] = [];
  for (const c of [...hand].sort((a,b) => a.rank - b.rank)) {
    if (c.rank <= 9 && !seenRanks.has(c.rank)) {
      kept.push(c);
      seenRanks.add(c.rank);
    }
  }
  const drawCount = 5 - kept.length;
  const keptRanks = kept.map(c => c.rank);
  const r = Array.from({length:5}, (_,i) => keptRanks[i] ?? 14);
  let score =
    (15 - r[4]) * 100_000 +
    (15 - r[3]) *  10_000 +
    (15 - r[2]) *   1_000 +
    (15 - r[1]) *     100 +
    (15 - r[0]) *      10;
  if (drawCount === 0) {
    const isStraight = isConsecutive(keptRanks);
    const isFlush    = allSameSuit(kept);
    if      (isStraight && isFlush) score -= 3_000_000;
    else if (isFlush)               score -= 2_000_000;
    else if (isStraight)            score -= 1_000_000;
  } else if (drawCount === 1) {
    const is4Flush    = allSameSuit(kept);
    const is4Straight = isConsecutive(keptRanks);
    if      (is4Flush && is4Straight) score -= 23_000;
    else if (is4Flush)                score -= 15_000;
    else if (is4Straight)             score -=  8_000;
  } else if (drawCount === 2) {
    const is3Flush    = allSameSuit(kept);
    const is3Straight = isConsecutive(keptRanks);
    if      (is3Flush && is3Straight) score -= 2_000;
    else if (is3Flush)                score -= 1_000;
    else if (is3Straight)             score -= 1_000;
  }
  return { drawCount, score };
}

function rankName(r: number): string {
  if (r === 10) return "T";
  if (r === 11) return "J";
  if (r === 12) return "Q";
  if (r === 13) return "K";
  if (r === 14) return "A";
  return String(r);
}

function handStr(hand: Card[]): string {
  return [...hand]
    .sort((a,b) => a.rank - b.rank)
    .map(c => rankName(c.rank) + c.suit)
    .join(" ");
}

interface BucketEntry {
  bestScore: number;
  worstScore: number;
  bestHand: Card[];
  worstHand: Card[];
  count: number;
}

const buckets: (BucketEntry | null)[] = Array(NUM_BUCKETS).fill(null);

const n = deck.length;
let total = 0;
for (let a = 0; a < n-4; a++)
for (let b = a+1; b < n-3; b++)
for (let c = b+1; c < n-2; c++)
for (let d = c+1; d < n-1; d++)
for (let e = d+1; e < n; e++) {
  const hand = [deck[a], deck[b], deck[c], deck[d], deck[e]];
  const bucket = handToBucket(hand);
  const { score } = handScore(hand);
  total++;
  const entry = buckets[bucket];
  if (!entry) {
    buckets[bucket] = { bestScore: score, worstScore: score, bestHand: hand, worstHand: hand, count: 1 };
  } else {
    entry.count++;
    if (score > entry.bestScore)  { entry.bestScore = score;  entry.bestHand = hand; }
    if (score < entry.worstScore) { entry.worstScore = score; entry.worstHand = hand; }
  }
}

console.log(`\nTotal hands enumerated: ${total.toLocaleString()}\n`);
console.log(`${"Bucket".padEnd(6)} ${"Label".padEnd(28)} ${"Count".padStart(8)}  ${"Best hand (strongest)".padEnd(30)} ${"Worst hand (weakest)".padEnd(30)}`);
console.log("─".repeat(115));

for (let i = 0; i < NUM_BUCKETS; i++) {
  const e = buckets[i];
  const label = bucketLabel(i).replace("Bucket " + i + " ", "");
  const count = e ? e.count.toLocaleString() : "0";
  const best  = e ? handStr(e.bestHand)  : "(empty)";
  const worst = e ? handStr(e.worstHand) : "(empty)";
  console.log(`${String(i).padStart(6)} ${label.padEnd(28)} ${count.padStart(8)}  ${best.padEnd(30)} ${worst.padEnd(30)}`);
}
