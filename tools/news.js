// tools/news.js
export async function run(topic = "technology") {
  const key = process.env.NEWSDATA_KEY;
  if (!key)
    return "News unavailable: NEWSDATA_KEY not set in Render environment.";

  const query = topic.trim() || "technology";
  try {
    const url = `https://newsdata.io/api/1/news?apikey=${key}&q=${encodeURIComponent(query)}&language=en`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.results?.length) return `No news found for "${query}".`;

    return data.results
      .slice(0, 5)
      .map((a, i) => `${i + 1}. ${a.title}\n   ${a.link}`)
      .join("\n\n");
  } catch (e) {
    return `News error: ${e.message}`;
  }
}
