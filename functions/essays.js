/**
 * Cloudflare Pages Function  —  route: /essays
 * --------------------------------------------------------------------------
 * Returns the latest Venture Wisely (Substack) essays as JSON. The site's
 * page fetches this from the SAME origin (/essays), so there's no CORS issue
 * and no relay.
 *
 * "Stays updated" with zero cron/KV setup: the upstream RSS fetch is cached at
 * Cloudflare's edge for 24h (cf.cacheTtl), so Substack is hit at most ~once a
 * day per location, and new posts appear within that window. The JSON response
 * is also cache-tagged for browsers/edge.
 *
 * On any failure it returns [] so the page keeps its hardcoded fallback essays.
 *
 * The page reads { title, link, tag, blurb } per item.
 * --------------------------------------------------------------------------
 */

const FEED_URL = 'https://www.venturewisely.com/feed';
const MAX = 5;
const EDGE_TTL = 86400; // seconds the upstream feed is cached at the edge (1 day)

// Optional: map a post's first Substack category to a nicer display label.
// Posts with no category just omit the small label. e.g. { 'ai': 'AI' }
const TAG_MAP = {};

export async function onRequestGet(context) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  };
  try {
    const items = await buildEssays();
    return new Response(JSON.stringify(items), { headers });
  } catch (e) {
    // feed unreachable / unparseable — empty array => page keeps fallback
    return new Response('[]', { headers });
  }
}

// ---- feed -> [{title, link, tag, blurb}] ----------------------------------
async function buildEssays() {
  const res = await fetch(FEED_URL, {
    headers: { 'User-Agent': 'venturewisely-essays-pages/1.0' },
    cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
  });
  if (!res.ok) throw new Error('feed HTTP ' + res.status);
  const xml = await res.text();

  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, MAX).map((block) => {
    const catMatch = block.match(/<category[^>]*>([\s\S]*?)<\/category>/i);
    return {
      title: field(block, 'title'),
      link: field(block, 'link'),
      tag: tagOf(catMatch ? decodeEntities(catMatch[1].trim()) : ''),
      blurb: clip(stripTags(field(block, 'description')), 150),
    };
  }).filter((it) => it.title && it.link);
}

function field(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? decodeEntities(m[1].trim()) : '';
}
function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => safeCp(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCp(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function safeCp(n) {
  try { return String.fromCodePoint(n); } catch (e) { return ''; }
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}
function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, '') + '\u2026';
}
function tagOf(raw) {
  const t = (raw || '').trim();
  if (!t) return '';
  return TAG_MAP[t.toLowerCase()] || t;
}
