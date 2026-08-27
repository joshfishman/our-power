/* eslint-disable react/no-children-prop */
import type { Metadata } from 'next';
import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { stripUnpublishedSections } from '@/lib/scorecard/methodology-doc';

export const metadata: Metadata = {
  title: 'Methodology | We the People Scorecard',
  description:
    'How every member of Congress and the California State Legislature is scored — same rubric for everyone, every point backed by a public source.',
};

// Force-dynamic so doc edits show up without redeploy. The doc is small.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function readMethodologyDoc(): Promise<string> {
  // Resolve relative to repo root. Next 15 server components run with
  // process.cwd() at the project root in both dev and Vercel builds.
  const docPath = path.join(process.cwd(), 'docs', 'scorecard-methodology.md');
  return stripUnpublishedSections(await fs.readFile(docPath, 'utf-8'));
}

export default async function MethodologyPage() {
  const markdown = await readMethodologyDoc();
  return (
    <div className="mx-auto max-w-site px-4 py-8">
      <Link href="/scorecard" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to scorecard
      </Link>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <Link
          href="/scorecard/methodology/pac-classes"
          className="rounded border border-border bg-secondary px-3 py-1 font-mono uppercase tracking-wide text-foreground hover:bg-secondary-accent">
          PAC classes →
        </Link>
        <Link
          href="/scorecard/ghost-beneficiary"
          className="rounded border border-border bg-secondary px-3 py-1 font-mono uppercase tracking-wide text-foreground hover:bg-secondary-accent">
          Ghost beneficiary $ →
        </Link>
      </div>
      <article className="mt-6 text-foreground [&_a]:text-accent [&_a]:underline hover:[&_a]:text-foreground [&_blockquote]:mt-4 [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mt-8 [&_h1]:border-b-2 [&_h1]:border-border [&_h1]:pb-3 [&_h1]:font-serif [&_h1]:text-4xl [&_h1]:font-bold [&_h1]:text-foreground [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:font-serif [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_p]:leading-relaxed [&_p]:text-foreground [&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_pre]:mt-4 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_strong]:font-semibold [&_strong]:text-foreground [&_table]:mt-4 [&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:border-collapse [&_table]:overflow-x-auto [&_table]:text-sm [&_td]:border-b [&_td]:border-border [&_td]:py-2 [&_td]:pr-4 [&_th]:border-b-2 [&_th]:border-border [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-mono [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </div>
  );
}
