// tools/search.js
export async function run(query = "") {
  if (!query.trim()) return "Usage: /search <query>";
  const encoded = encodeURIComponent(query.trim());
  const ddgUrl = `https://duckduckgo.com/?q=${encoded}`;
  const googleUrl = `https://www.google.com/search?q=${encoded}`;
  return `Search results for "${query}":\n🦆 DuckDuckGo: ${ddgUrl}\n🔍 Google: ${googleUrl}`;
}
