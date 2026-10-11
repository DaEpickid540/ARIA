// Run: npm test   (or node --test tests/fetcher.test.mjs)
// The page fetcher behind the crawler, the scrape tool and research
// (lib/research.js). URLs come from the model and from pages it reads, so it
// must never reach this machine or the local network, redirects included.
// fetch is stubbed: nothing here touches the network.
import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, isSafeHttpUrl, linksOf, fetchReadable } from "../lib/research.js";

delete process.env.TAVILY_API_KEY; // no fallback fetches through Tavily here

const PUBLIC = "http://93.184.215.14"; // an IP literal: no DNS lookup
const ARTICLE = `<html><head><title>A page</title></head><body><p>${"Readable words. ".repeat(40)}</p>
  <a href="/next">next</a><a href="https://other.example/x#frag">other</a></body></html>`;

/** Replace fetch with a script of responses; records every URL asked for. */
function stubFetch(t, script) {
  const asked = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const step = script(String(url), asked.length);
    if (step instanceof Response) return step;
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => (globalThis.fetch = real));
  return asked;
}
const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const redirect = (to, status = 302) => new Response(null, { status, headers: { location: to } });

test("isPrivateAddress: loopback, private, link-local and mapped forms", () => {
  const priv = ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fd12::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:c0a8:101", "64:ff9b::10.0.0.1"];
  const pub = ["8.8.8.8", "93.184.215.14", "100.63.255.255", "100.128.0.1", "172.15.0.1", "172.32.0.1",
    "2606:4700:4700::1111", "::ffff:808:808"];
  for (const ip of priv) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of pub) assert.equal(isPrivateAddress(ip), false, ip);
});

test("isSafeHttpUrl: http(s) to public hosts only", () => {
  assert.equal(isSafeHttpUrl("https://example.com/a"), true);
  assert.equal(isSafeHttpUrl(`${PUBLIC}/`), true);
  for (const bad of ["ftp://example.com", "javascript:alert(1)", "file:///etc/passwd", "not a url",
    "http://localhost:3717", "http://printer.local/", "http://nas.lan/", "http://127.0.0.1:3717",
    "http://[::1]/", "http://[::ffff:127.0.0.1]:3717/", "http://2130706433/", "http://0x7f.1/"])
    assert.equal(isSafeHttpUrl(bad), false, bad);
});

test("linksOf: absolute, de-duplicated, http(s) only, no fragments", () => {
  const links = linksOf(
    `<a href="/a#x">1</a><a href='https://x.com/b'>2</a><a href="javascript:alert(1)">3</a>
     <a href="#top">4</a><a href="/a">5</a><a href="mailto:a@b.c">6</a><a href="c?x=1&amp;y=2">7</a>`,
    "https://ex.com/dir/page",
  );
  assert.deepEqual(links, ["https://ex.com/a", "https://x.com/b", "https://ex.com/dir/c?x=1&y=2"]);
});

test("fetchReadable: a private URL is refused before anything is fetched", async (t) => {
  const asked = stubFetch(t, () => null);
  for (const u of ["http://127.0.0.1:3717/api/health", "http://localhost/", "http://192.168.0.10/admin"]) {
    const r = await fetchReadable(u);
    assert.equal(r.ok, false);
    assert.match(r.error, /blocked/);
  }
  assert.equal(asked.length, 0);
});

test("fetchReadable: a public page redirecting to this machine is refused at the hop", async (t) => {
  const asked = stubFetch(t, (url) => (url.startsWith(PUBLIC) ? redirect("http://127.0.0.1:3717/api/claw") : null));
  const r = await fetchReadable(`${PUBLIC}/innocent`);
  assert.equal(r.ok, false);
  assert.match(r.error, /blocked/);
  assert.deepEqual(asked, [`${PUBLIC}/innocent`]); // the loopback URL was never requested
});

test("fetchReadable: ordinary redirects are followed, links resolve against the final URL", async (t) => {
  const asked = stubFetch(t, (url) =>
    url === `${PUBLIC}/old` ? redirect("/new", 301) : url === `${PUBLIC}/new` ? html(ARTICLE) : null,
  );
  const r = await fetchReadable(`${PUBLIC}/old`, { links: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.title, "A page");
  assert.deepEqual(asked, [`${PUBLIC}/old`, `${PUBLIC}/new`]);
  assert.deepEqual(r.links, [`${PUBLIC}/next`, "https://other.example/x"]);
});

test("fetchReadable: a redirect loop stops", async (t) => {
  const asked = stubFetch(t, (url, n) => redirect(`${PUBLIC}/hop${n}`));
  const r = await fetchReadable(`${PUBLIC}/start`);
  assert.equal(r.ok, false);
  assert.match(r.error, /too many redirects/);
  assert.ok(asked.length <= 6, `followed ${asked.length} hops`);
});

test("fetchReadable: not a web page", async (t) => {
  stubFetch(t, () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
  const r = await fetchReadable(`${PUBLIC}/file.pdf`);
  assert.equal(r.ok, false);
  assert.match(r.error, /not a web page/);
});

test("fetchReadable: a huge body is cut off instead of read whole", async (t) => {
  let pulled = 0;
  const chunk = new TextEncoder().encode(`<p>${"x".repeat(65_530)}</p>`);
  stubFetch(t, () => {
    const body = new ReadableStream({
      pull(c) {
        pulled += chunk.byteLength;
        if (pulled > 50_000_000) c.close(); // a 50 MB "page"
        else c.enqueue(chunk);
      },
    });
    return new Response(body, { headers: { "content-type": "text/html" } });
  });
  const r = await fetchReadable(`${PUBLIC}/huge`, { maxChars: 1000 });
  assert.ok(pulled < 4_000_000, `read ${pulled} bytes`);
  assert.ok(r.text.length <= 1000);
});
