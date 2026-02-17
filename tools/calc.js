// tools/calc.js
export async function run(input) {
  try {
    const result = eval(input);
    return `Result: ${result}`;
  } catch {
    return "Invalid expression.";
  }
}
