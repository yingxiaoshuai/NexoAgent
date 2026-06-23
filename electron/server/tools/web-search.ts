import type { SearchResult } from "../types";
import { decodeHtml, getOptionalNumberArg, getStringArg, stripHtml } from "../utils";
import { serverLog } from "../logger";

const DEFAULT_SEARCH_RESULT_COUNT = 5;

function queryTokens(query: string) {
  return Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []));
}

function isRelevantSearchResult(query: string, result: SearchResult) {
  const tokens = queryTokens(query).filter((token) => ![
    "latest",
    "news",
    "price",
    "stock",
    "search",
    "\u6700\u65b0",
    "\u884c\u60c5",
    "\u80a1\u7968",
    "\u641c\u7d22",
    "2025",
    "2026",
  ].includes(token));
  if (!tokens.length) return true;
  const haystack = `${result.title}\n${result.url}\n${result.snippet}`.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function formatSearchResults(results: SearchResult[], source: string) {
  if (!results.length) {
    return "No relevant search results returned. For reliable live web search, configure BING_SEARCH_API_KEY or use a more specific query.";
  }
  return [
    `Source: ${source}`,
    ...results.slice(0, DEFAULT_SEARCH_RESULT_COUNT).map((result, index) =>
      `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet || "(no snippet)"}`,
    ),
  ].join("\n");
}

function extractBingTargetUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const encoded = url.searchParams.get("u");
    if (url.hostname.includes("bing.com") && encoded) {
      const normalized = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
      return Buffer.from(normalized, "base64").toString("utf8");
    }
  } catch {
    // Keep original URL when decoding fails.
  }
  return rawUrl;
}

async function searchWithBingApi(query: string, count: number): Promise<SearchResult[]> {
  const apiKey = process.env.BING_SEARCH_API_KEY || process.env.AZURE_BING_SEARCH_API_KEY;
  if (!apiKey) return [];

  const endpoint = process.env.BING_SEARCH_ENDPOINT || "https://api.bing.microsoft.com/v7.0/search";
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("responseFilter", "Webpages");
  url.searchParams.set("safeSearch", "Moderate");
  url.searchParams.set("mkt", "zh-CN");

  const response = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!response.ok) throw new Error(`Bing Search API failed: ${response.status}`);

  const data = await response.json() as {
    webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> };
  };
  return (data.webPages?.value ?? [])
    .filter((item) => item.name && item.url)
    .map((item) => ({
      title: item.name ?? "",
      url: item.url ?? "",
      snippet: item.snippet ?? "",
    }))
    .filter((item) => isRelevantSearchResult(query, item));
}

async function searchWithBingHtml(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("cc", "cn");
  url.searchParams.set("mkt", "zh-CN");
  url.searchParams.set("setlang", "zh-Hans");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`Bing HTML search failed: ${response.status}`);

  const html = await response.text();
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) ?? [];
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const href = extractBingTargetUrl(decodeHtml(link[1]));
    const title = stripHtml(link[2]);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";
    const result = { title, url: href, snippet };
    if (!href || !title || seen.has(href) || !isRelevantSearchResult(query, result)) continue;
    seen.add(href);
    results.push(result);
    if (results.length >= count) break;
  }

  return results;
}

async function searchWithDuckDuckGoInstantAnswer(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`DuckDuckGo Instant Answer failed: ${response.status}`);

  const data = await response.json() as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  };

  const results: SearchResult[] = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    const items = topic.Topics ?? [topic];
    for (const item of items) {
      if (!item.Text || !item.FirstURL) continue;
      const result = { title: item.Text.split(" - ")[0] || query, url: item.FirstURL, snippet: item.Text };
      if (!isRelevantSearchResult(query, result)) continue;
      results.push(result);
      if (results.length >= count) return results;
    }
  }

  return results;
}

function detectAStockCode(query: string) {
  const match = query.match(/\b([036]\d{5})\b/);
  if (!match) return null;
  const code = match[1];
  const market = code.startsWith("6") ? "sh" : "sz";
  return { code, market, symbol: `${market}${code}` };
}

function toFixedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function searchAStockQuote(query: string) {
  const stock = detectAStockCode(query);
  if (!stock) return null;

  const response = await fetch(`https://hq.sinajs.cn/list=${stock.symbol}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://finance.sina.com.cn",
    },
  });
  if (!response.ok) throw new Error(`Sina quote failed: ${response.status}`);

  const text = new TextDecoder("gb18030").decode(await response.arrayBuffer());
  const match = text.match(/="([^"]*)"/);
  const fields = match?.[1]?.split(",") ?? [];
  if (fields.length < 32 || !fields[0]) return null;

  const name = fields[0].replace(/\s+/g, "");
  const open = Number(fields[1]);
  const prevClose = Number(fields[2]);
  const current = Number(fields[3]);
  const high = Number(fields[4]);
  const low = Number(fields[5]);
  const volume = Number(fields[8]);
  const amount = Number(fields[9]);
  const date = fields[30];
  const time = fields[31];
  const change = current - prevClose;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  const eastmoneyCode = stock.market === "sh" ? `1.${stock.code}` : `0.${stock.code}`;

  return [
    "Source: Sina Finance quote",
    `Stock: ${name} (${stock.code}.${stock.market.toUpperCase()})`,
    `Quote time: ${date} ${time}`,
    `Current: ${current.toFixed(3)}`,
    `Change: ${change >= 0 ? "+" : ""}${change.toFixed(3)} (${toFixedPercent(changePercent)})`,
    `Open / High / Low / Prev close: ${open.toFixed(3)} / ${high.toFixed(3)} / ${low.toFixed(3)} / ${prevClose.toFixed(3)}`,
    `Volume: ${volume.toLocaleString("zh-CN")} shares`,
    `Turnover: ${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} CNY`,
    "",
    "Reference links:",
    `1. Sina Finance https://finance.sina.com.cn/realstock/company/${stock.symbol}/nc.shtml`,
    `2. Eastmoney Quote https://quote.eastmoney.com/${stock.market}${stock.code}.html`,
    `3. Eastmoney Survey https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/Index?type=web&code=${eastmoneyCode}`,
    `4. CNInfo Search https://www.cninfo.com.cn/new/fulltextSearch?notautosubmit=&keyWord=${stock.code}`,
  ].join("\n");
}

export async function webSearch(args: Record<string, unknown>) {
  const query = getStringArg(args, "query", ["q"]);
  const count = Math.max(1, Math.min(10, Math.floor(getOptionalNumberArg(args, "count", DEFAULT_SEARCH_RESULT_COUNT))));

  const stockQuote = await searchAStockQuote(query);
  if (stockQuote) return stockQuote;

  const bingApiResults = await searchWithBingApi(query, count);
  if (bingApiResults.length) return formatSearchResults(bingApiResults, "Bing Search API");

  try {
    const bingHtmlResults = await searchWithBingHtml(query, count);
    if (bingHtmlResults.length) return formatSearchResults(bingHtmlResults, "Bing web search");
  } catch (error) {
    serverLog(`Bing HTML search fallback failed: ${String(error)}`);
  }

  const ddgResults = await searchWithDuckDuckGoInstantAnswer(query, count);
  return formatSearchResults(ddgResults, "DuckDuckGo Instant Answer");
}
