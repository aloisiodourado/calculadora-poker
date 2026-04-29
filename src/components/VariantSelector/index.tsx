"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PokerVariant } from "@/engine/variants";
import { VARIANT_CONFIGS } from "@/engine/variants/config";

interface VariantSelectorProps {
  value: PokerVariant;
  onChange: (variant: PokerVariant) => void;
}

const VARIANT_GROUPS = [
  {
    label: "High Hand",
    variants: [PokerVariant.TexasHoldem, PokerVariant.OmahaHi, PokerVariant.SevenCardStud],
  },
  {
    label: "Hi-Lo Split",
    variants: [PokerVariant.OmahaHiLo, PokerVariant.StudHiLo],
  },
  {
    label: "Lowball",
    variants: [PokerVariant.Razz, PokerVariant.SingleDraw27, PokerVariant.TripleDraw27, PokerVariant.TripleDraw27WIP],
  },
  {
    label: "Other",
    variants: [PokerVariant.Badugi],
  },
];

export function VariantSelector({ value, onChange }: VariantSelectorProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Variant
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as PokerVariant)}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VARIANT_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                {group.label}
              </div>
              {group.variants.map((variant) => (
                <SelectItem key={variant} value={variant}>
                  {VARIANT_CONFIGS[variant].name}
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
