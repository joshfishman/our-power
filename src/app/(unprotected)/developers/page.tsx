import Link from 'next/link';

export const metadata = {
  title: 'Developer API | Our Power',
  description: 'Public API documentation for integrating with Our Power campaigns and actions.',
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-4 text-sm dark:bg-neutral-800">
      <code>{children}</code>
    </pre>
  );
}

function Endpoint({
  method,
  path,
  description,
  params,
  example,
}: {
  method: string;
  path: string;
  description: string;
  params?: { name: string; type: string; desc: string }[];
  example?: string;
}) {
  return (
    <div className="mb-8 rounded-lg border border-neutral-200 p-5 dark:border-neutral-700">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
          {method}
        </span>
        <code className="text-sm font-semibold">{path}</code>
      </div>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
      {params && params.length > 0 && (
        <div className="mb-3">
          <h4 className="mb-1 text-xs font-semibold uppercase text-neutral-500">Parameters</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="py-1 text-left font-medium">Name</th>
                <th className="py-1 text-left font-medium">Type</th>
                <th className="py-1 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.name} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className="py-1">
                    <code className="text-xs">{p.name}</code>
                  </td>
                  <td className="py-1 text-neutral-500">{p.type}</td>
                  <td className="py-1 text-neutral-600 dark:text-neutral-400">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {example && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase text-neutral-500">Example</h4>
          <CodeBlock>{example}</CodeBlock>
        </div>
      )}
    </div>
  );
}

export default function DevelopersPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-0">
      <h1 className="mb-2 text-3xl font-bold">Developer API</h1>
      <p className="mb-8 text-neutral-600 dark:text-neutral-400">
        Use Our Power&apos;s public API to integrate campaigns, actions, and causes into your own applications,
        websites, or tools. All public endpoints support CORS and require no authentication.
      </p>

      {/* Rate Limiting */}
      <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
        <h3 className="mb-1 font-semibold text-amber-800 dark:text-amber-300">Rate Limiting</h3>
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Public API endpoints are limited to <strong>60 requests per minute</strong> per IP address. If you exceed this
          limit, you&apos;ll receive a <code>429</code> response with a <code>Retry-After</code> header.
        </p>
      </div>

      {/* Campaigns */}
      <h2 className="mb-4 mt-10 text-2xl font-bold">Campaigns</h2>

      <Endpoint
        method="GET"
        path="/api/campaigns"
        description="List active campaigns with pagination."
        params={[
          { name: 'causeId', type: 'string', desc: 'Filter by cause ID' },
          { name: 'orgId', type: 'string', desc: 'Filter by organization ID' },
          { name: 'status', type: 'string', desc: 'Filter by status (ACTIVE, DRAFT, etc.)' },
          { name: 'limit', type: 'number', desc: 'Max results (default 20)' },
          { name: 'offset', type: 'number', desc: 'Pagination offset (default 0)' },
        ]}
        example="GET /api/campaigns?causeId=clxyz&limit=10"
      />

      <Endpoint
        method="GET"
        path="/api/campaigns/:id"
        description="Get detailed info for a single campaign, including its upcoming actions."
        example="GET /api/campaigns/clxyz123"
      />

      {/* Actions */}
      <h2 className="mb-4 mt-10 text-2xl font-bold">Actions</h2>

      <Endpoint
        method="GET"
        path="/api/actions"
        description="List active actions across all campaigns."
        params={[
          { name: 'campaignId', type: 'string', desc: 'Filter by campaign ID' },
          { name: 'type', type: 'string', desc: 'Filter by type: EVENT, PHONE, EMAIL, CANVASS' },
          { name: 'upcoming', type: 'boolean', desc: 'Only show future actions (true/false)' },
          { name: 'limit', type: 'number', desc: 'Max results (default 20)' },
        ]}
        example="GET /api/actions?type=EVENT&upcoming=true"
      />

      {/* Organizations */}
      <h2 className="mb-4 mt-10 text-2xl font-bold">Organizations</h2>

      <Endpoint
        method="GET"
        path="/api/organizations"
        description="List all organizations."
        example="GET /api/organizations"
      />

      <Endpoint
        method="GET"
        path="/api/organizations/:id"
        description="Get details for a single organization, including its campaigns."
        example="GET /api/organizations/clxyz123"
      />

      {/* Causes */}
      <h2 className="mb-4 mt-10 text-2xl font-bold">Causes</h2>

      <Endpoint
        method="GET"
        path="/api/causes"
        description="List all activism cause categories."
        example="GET /api/causes"
      />

      {/* RSS Feeds */}
      <h2 className="mb-4 mt-10 text-2xl font-bold">RSS Feeds</h2>
      <p className="mb-4 text-neutral-600 dark:text-neutral-400">
        Subscribe to RSS feeds for real-time updates on campaigns and actions. All feeds return standard RSS 2.0 XML
        with custom <code>op:</code> namespace extensions for activism-specific data.
      </p>

      <Endpoint
        method="GET"
        path="/api/rss/campaigns"
        description="RSS feed of active campaigns. Optional causeId filter."
        params={[{ name: 'causeId', type: 'string', desc: 'Filter by cause ID' }]}
      />

      <Endpoint
        method="GET"
        path="/api/rss/campaigns/:id/actions"
        description="RSS feed of upcoming actions for a specific campaign."
      />

      <Endpoint
        method="GET"
        path="/api/rss/actions"
        description="RSS feed of all upcoming actions. Optional type filter."
        params={[{ name: 'type', type: 'string', desc: 'Filter: EVENT, PHONE, EMAIL, CANVASS' }]}
      />

      <Endpoint
        method="GET"
        path="/api/rss/organizations/:id"
        description="RSS feed of campaigns from a specific organization."
      />

      <Endpoint method="GET" path="/api/rss/causes/:id" description="RSS feed of campaigns for a specific cause." />

      {/* Embeddable Widgets */}
      <h2 className="mb-4 mt-10 text-2xl font-bold">Embeddable Widgets</h2>
      <p className="mb-4 text-neutral-600 dark:text-neutral-400">
        Embed campaign or action cards on your website with a simple script tag. Visit the{' '}
        <Link href="/embed" className="text-sky-600 underline hover:text-sky-700 dark:text-sky-400">
          Embed Generator
        </Link>{' '}
        to preview and copy embed codes.
      </p>

      <div className="mb-4">
        <h3 className="mb-2 font-semibold">Campaign Widget</h3>
        <CodeBlock>{`<div data-op-widget="campaign" data-campaign-id="YOUR_CAMPAIGN_ID"></div>\n<script src="https://ourpower.com/embed/widget.js" async></script>`}</CodeBlock>
      </div>

      <div className="mb-4">
        <h3 className="mb-2 font-semibold">Action Widget</h3>
        <CodeBlock>{`<div data-op-widget="action" data-action-id="YOUR_ACTION_ID"></div>\n<script src="https://ourpower.com/embed/widget.js" async></script>`}</CodeBlock>
      </div>
    </article>
  );
}
