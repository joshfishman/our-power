/**
 * RSS 2.0 feed builder helper.
 * Generates well-formed RSS XML from structured feed data.
 */

export interface RssFeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  guid: string;
  /** Optional custom elements as key-value pairs, e.g. { 'op:cause': 'Climate' } */
  customElements?: Record<string, string>;
}

export interface RssFeedOptions {
  title: string;
  description: string;
  link: string;
  language?: string;
  items: RssFeedItem[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildRssFeed(options: RssFeedOptions): string {
  const { title, description, link, language = 'en-us', items } = options;

  const itemsXml = items
    .map((item) => {
      const customXml = item.customElements
        ? Object.entries(item.customElements)
            .map(([key, value]) => `      <${key}>${escapeXml(value)}</${key}>`)
            .join('\n')
        : '';

      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>
      <guid isPermaLink="true">${escapeXml(item.guid)}</guid>
${customXml}
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:op="https://ourpower.com/rss/ns">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <description>${escapeXml(description)}</description>
    <language>${language}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Our Power</generator>
${itemsXml}
  </channel>
</rss>`;
}

/** Standard RSS response with caching headers */
export function rssResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900, s-maxage=3600',
    },
  });
}

/** Get the site base URL from environment */
export function getSiteUrl(): string {
  return process.env.URL || process.env.AUTH_URL || 'https://ourpower.com';
}
