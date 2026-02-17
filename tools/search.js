// tools/search.js
export async function run(query = "") {
  if (!query.trim()) return "Usage: /search <query>";
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
  return `Search results: ${url}`;
}
