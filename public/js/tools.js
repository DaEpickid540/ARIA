export async function runTool(toolName, input) {
  const res = await fetch("/api/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: toolName, input }),
  });

  const data = await res.json();
  return data.output;
}
