// tools/dice.js — a drop-in tool.
//
// This file is not registered anywhere. It is picked up because it exports
// TOOL_META and run(), which is the whole point of the discovery mechanism
// ported from the AGI harness: to add a tool, write one file.
//
// Copy this shape for new tools.

export const TOOL_META = {
  name: "dice",
  desc: "Roll dice — /dice 2d6, /dice d20+3",
  args: "<count>d<sides>[+/-modifier], e.g. 2d6 or d20+3",
};

const MAX_DICE = 100;
const MAX_SIDES = 1000;

export async function run(input = "") {
  const spec = String(input).trim().toLowerCase() || "d20";

  const m = spec.match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/);
  if (!m) return "Usage: /dice 2d6, /dice d20+3";

  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;

  if (count < 1 || count > MAX_DICE) return `Roll between 1 and ${MAX_DICE} dice.`;
  if (sides < 2 || sides > MAX_SIDES) return `Dice need 2 to ${MAX_SIDES} sides.`;

  const rolls = Array.from(
    { length: count },
    () => 1 + Math.floor(Math.random() * sides),
  );
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;

  const detail = count > 1 ? ` (${rolls.join(", ")})` : "";
  const mod = modifier ? ` ${modifier > 0 ? "+" : "−"} ${Math.abs(modifier)}` : "";
  return `🎲 ${spec} → **${total}**${detail}${mod}`;
}
