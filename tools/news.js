import axios from "axios";

export default async function newsTool() {
  const key = process.env.NEWS_API_KEY;
  if (!key) return "News API key missing.";

  const url = `https://newsapi.org/v2/top-headlines?country=us&apiKey=${key}`;

  try {
    const res = await axios.get(url);
    const article = res.data.articles[0];
    return `Top headline: ${article.title}`;
  } catch {
    return "Couldn't fetch news.";
  }
}
