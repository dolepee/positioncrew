import type { LucideIcon } from "lucide-react";
import { Activity, ChartNoAxesCombined, Grid3X3, RefreshCw } from "lucide-react";
import type { ServiceId } from "./types";

export interface TaskConfig {
  id: ServiceId;
  index: string;
  title: string;
  shortTitle: string;
  action: string;
  description: string;
  icon: LucideIcon;
  inputs: Array<{ label: string; value: string; emphasis?: boolean }>;
}

export const TASKS: TaskConfig[] = [
  {
    id: "LENDING_RESCUE",
    index: "01",
    title: "Rescue a lending position",
    shortTitle: "Lending rescue",
    action: "Run rescue check",
    description: "Find the smallest allowed action that restores a stressed lending position.",
    icon: Activity,
    inputs: [
      { label: "Protocol", value: "Venus" },
      { label: "Current HF", value: "1.043", emphasis: true },
      { label: "Stress HF", value: "0.939", emphasis: true },
      { label: "Target HF", value: "1.250" },
      { label: "Action cap", value: "$250" },
      { label: "Max slippage", value: "30 bps" },
    ],
  },
  {
    id: "LP_REBALANCE",
    index: "02",
    title: "Reset an LP range",
    shortTitle: "LP rebalance",
    action: "Run range check",
    description: "Move an out-of-range position only when net benefit clears hard costs.",
    icon: RefreshCw,
    inputs: [
      { label: "Current tick", value: "150", emphasis: true },
      { label: "Current range", value: "-120 to 120" },
      { label: "Position", value: "$10,000" },
      { label: "24h fees", value: "$2,000" },
      { label: "Min benefit", value: "$5" },
      { label: "Tick spacing", value: "60" },
    ],
  },
  {
    id: "YIELD_OPTIMIZATION",
    index: "03",
    title: "Improve a yield allocation",
    shortTitle: "Yield optimise",
    action: "Compare allocation",
    description: "Choose an allowlisted destination after costs, liquidity, lockup, and risk checks.",
    icon: ChartNoAxesCombined,
    inputs: [
      { label: "Capital", value: "$1,000" },
      { label: "Current APY", value: "4.00%" },
      { label: "Candidate APY", value: "9.00%", emphasis: true },
      { label: "Risk ceiling", value: "Medium" },
      { label: "Min liquidity", value: "$1m" },
      { label: "Horizon", value: "90 days" },
    ],
  },
  {
    id: "BOUNDED_GRID",
    index: "04",
    title: "Build or reject a bounded grid",
    shortTitle: "Bounded grid",
    action: "Build bounded grid",
    description: "Construct orders only inside inventory, loss, liquidity, and volatility limits.",
    icon: Grid3X3,
    inputs: [
      { label: "Pair", value: "WBNB / USDT" },
      { label: "Mid price", value: "$10.00" },
      { label: "Grid range", value: "$9 to $11" },
      { label: "Capital", value: "$1,000" },
      { label: "Loss cap", value: "$150", emphasis: true },
      { label: "Levels", value: "5" },
    ],
  },
];
