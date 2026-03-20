// tools/calc.js — safe math evaluator (no dependencies)
// Allows: numbers, + - * / ^ % ( ) . and Math functions
export async function run(input) {
  if (!input?.trim()) return "Usage: /calc <expression>  e.g. /calc 2+2*5";

  const expr = input.trim();

  // Whitelist: only allow safe math characters
  if (
    /[^0-9+\-*/^%.()\s,]/.test(
      expr
        .replace(/\bMath\.\w+\b/g, "")
        .replace(/\bsqrt|abs|floor|ceil|round|log|sin|cos|tan|pi|e\b/gi, ""),
    )
  ) {
    return "Invalid characters in expression. Only numbers and math operators allowed.";
  }

  try {
    // Replace common math shortcuts
    const safe = expr
      .replace(/\^/g, "**") // ^ = power
      .replace(/\bsqrt\b/g, "Math.sqrt")
      .replace(/\babs\b/g, "Math.abs")
      .replace(/\bfloor\b/g, "Math.floor")
      .replace(/\bceil\b/g, "Math.ceil")
      .replace(/\bround\b/g, "Math.round")
      .replace(/\blog\b/g, "Math.log")
      .replace(/\bsin\b/g, "Math.sin")
      .replace(/\bcos\b/g, "Math.cos")
      .replace(/\btan\b/g, "Math.tan")
      .replace(/\bpi\b/gi, "Math.PI")
      .replace(/\be\b/g, "Math.E");

    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${safe})`)();
    if (typeof result !== "number" || !isFinite(result))
      return "Result is not a finite number.";
    return `= ${Number.isInteger(result) ? result : result.toFixed(6).replace(/\.?0+$/, "")}`;
  } catch (e) {
    return `Could not evaluate: ${e.message}`;
  }
}
