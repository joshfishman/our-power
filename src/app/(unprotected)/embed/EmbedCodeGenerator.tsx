'use client';

import { useState } from 'react';

type CampaignData = {
  id: string;
  name: string;
  cause: { name: string; icon: string | null };
  org: { name: string };
  actions: { id: string; title: string; type: string }[];
};

export function EmbedCodeGenerator({ campaigns, siteUrl }: { campaigns: CampaignData[]; siteUrl: string }) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [selectedActionId, setSelectedActionId] = useState<string>('');
  const [widgetType, setWidgetType] = useState<'campaign' | 'action'>('campaign');
  const [theme, setTheme] = useState<'' | 'dark'>('');
  const [copied, setCopied] = useState(false);

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);

  function getEmbedCode() {
    if (widgetType === 'campaign' && selectedCampaignId) {
      return `<div data-op-widget="campaign" data-campaign-id="${selectedCampaignId}"${
        theme ? ` data-theme="${theme}"` : ''
      }></div>\n<script src="${siteUrl}/embed/widget.js" async></script>`;
    }
    if (widgetType === 'action' && selectedActionId) {
      return `<div data-op-widget="action" data-action-id="${selectedActionId}"${
        theme ? ` data-theme="${theme}"` : ''
      }></div>\n<script src="${siteUrl}/embed/widget.js" async></script>`;
    }
    return '';
  }

  function handleCopy() {
    const code = getEmbedCode();
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const embedCode = getEmbedCode();

  return (
    <div>
      {/* Widget Type */}
      <div className="mb-6">
        <span className="mb-2 block text-sm font-semibold">Widget Type</span>
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              widgetType === 'campaign'
                ? 'bg-sky-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
            onClick={() => {
              setWidgetType('campaign');
              setSelectedActionId('');
            }}>
            Campaign
          </button>
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              widgetType === 'action'
                ? 'bg-sky-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
            onClick={() => setWidgetType('action')}>
            Action
          </button>
        </div>
      </div>

      {/* Campaign Select */}
      <div className="mb-6">
        <label htmlFor="embed-campaign-select" className="mb-2 block text-sm font-semibold">
          Campaign
        </label>
        <select
          id="embed-campaign-select"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
          value={selectedCampaignId}
          onChange={(e) => {
            setSelectedCampaignId(e.target.value);
            setSelectedActionId('');
          }}>
          <option value="">Select a campaign...</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.cause.icon} {c.name} — {c.org.name}
            </option>
          ))}
        </select>
      </div>

      {/* Action Select (only for action widgets) */}
      {widgetType === 'action' && selectedCampaign && selectedCampaign.actions.length > 0 && (
        <div className="mb-6">
          <label htmlFor="embed-action-select" className="mb-2 block text-sm font-semibold">
            Action
          </label>
          <select
            id="embed-action-select"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
            value={selectedActionId}
            onChange={(e) => setSelectedActionId(e.target.value)}>
            <option value="">Select an action...</option>
            {selectedCampaign.actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.type} — {a.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Theme */}
      <div className="mb-6">
        <span className="mb-2 block text-sm font-semibold">Theme</span>
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              theme === ''
                ? 'bg-sky-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
            onClick={() => setTheme('')}>
            Light
          </button>
          <button
            type="button"
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              theme === 'dark'
                ? 'bg-sky-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300'
            }`}
            onClick={() => setTheme('dark')}>
            Dark
          </button>
        </div>
      </div>

      {/* Embed Code Output */}
      {embedCode && (
        <div className="mb-6">
          <span className="mb-2 block text-sm font-semibold">Embed Code</span>
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-4 text-sm dark:bg-neutral-800">
              <code>{embedCode}</code>
            </pre>
            <button
              type="button"
              className="absolute right-2 top-2 rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-700"
              onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Preview */}
      {embedCode && (
        <div className="mb-6">
          <span className="mb-2 block text-sm font-semibold">Preview</span>
          <div className="rounded-lg border border-dashed border-neutral-300 p-6 dark:border-neutral-600">
            <div
              dangerouslySetInnerHTML={{
                __html: embedCode.replace(
                  '<script',
                  '<!-- script tag will load on external site --><script style="display:none"',
                ),
              }}
            />
            <p className="mt-3 text-center text-xs text-subtle-foreground">
              Note: The widget preview requires the script to run. Copy the code to an external page to see the full
              widget.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
