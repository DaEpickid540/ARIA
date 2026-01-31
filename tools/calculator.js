export default async function calculatorTool(message) {
  const expr = message.replace(/calculate|calc|what is/gi, "").trim();

  try {
    const result = Function(`return (${expr})`)();
    return `Result: ${result}`;
  } catch {
    return "Invalid expression.";
  }
}
