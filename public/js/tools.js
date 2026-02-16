export async function runTool(tool, input) {
  try {
    const res = await fetch("/api/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, input }),
    });
    const data = await res.json();
    return data.output || "[No tool output]";
  } catch {
    return "[Tool error]";
  }
}
