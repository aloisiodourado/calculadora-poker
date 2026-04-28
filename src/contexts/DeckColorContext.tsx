"use client";

import { createContext, useContext, useState } from "react";
import { Suit } from "@/engine/cards";

export type DeckColorScheme = "4color" | "2color";

export const SUIT_COLORS_4: Record<Suit, string> = {
  [Suit.Spades]:   "text-slate-900",
  [Suit.Hearts]:   "text-red-600",
  [Suit.Diamonds]: "text-blue-600",
  [Suit.Clubs]:    "text-green-700",
};

export const SUIT_COLORS_2: Record<Suit, string> = {
  [Suit.Spades]:   "text-slate-900",
  [Suit.Hearts]:   "text-red-600",
  [Suit.Diamonds]: "text-red-600",
  [Suit.Clubs]:    "text-slate-900",
};

interface DeckColorContextValue {
  scheme: DeckColorScheme;
  suitColors: Record<Suit, string>;
  toggle: () => void;
}

const DeckColorContext = createContext<DeckColorContextValue>({
  scheme: "4color",
  suitColors: SUIT_COLORS_4,
  toggle: () => {},
});

export function DeckColorProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setScheme] = useState<DeckColorScheme>("4color");

  return (
    <DeckColorContext.Provider
      value={{
        scheme,
        suitColors: scheme === "4color" ? SUIT_COLORS_4 : SUIT_COLORS_2,
        toggle: () => setScheme((s) => (s === "4color" ? "2color" : "4color")),
      }}
    >
      {children}
    </DeckColorContext.Provider>
  );
}

export function useDeckColor() {
  return useContext(DeckColorContext);
}
