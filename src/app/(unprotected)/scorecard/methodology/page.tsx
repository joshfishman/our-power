/* eslint-disable react/no-children-prop */
import type { Metadata } from 'next';
import fs from 'node:fs/promises';
import path from 'node:path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  return fs.readFile(docPath, 'utf-8');
}

export default async function MethodologyPage() {
  const markdown = await readMethodologyDoc();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-[#2C4A5E]/90 hover:text-[#2C4A5E]">
        ← Back to scorecard
      </Link>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <Link
          href="/scorecard/methodology/pac-classes"
          className="rounded border border-[#2C4A5E]/40 bg-[#2C4A5E]/60 px-3 py-1 font-mono uppercase tracking-wide text-[#F5DEB3] hover:bg-[#2C4A5E]/80">
          PAC classes →
        </Link>
        <Link
          href="/scorecard/ghost-beneficiary"
          className="rounded border border-[#2C4A5E]/40 bg-[#2C4A5E]/60 px-3 py-1 font-mono uppercase tracking-wide text-[#F5DEB3] hover:bg-[#2C4A5E]/80">
          Ghost beneficiary $ →
        </Link>
      </div>
      <article className="mt-6 border border-gray-200 text-[#2C4A5E] shadow-sm [&_a]:text-[#8B3A3A] [&_a]:underline hover:[&_a]:text-[#FFE9B8] [&_blockquote]:mt-4 [&_blockquote]:border-l-4 [&_blockquote]:border-[#8B3A3A] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[#2C4A5E] [&_code]:rounded [&_code]:bg-white [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mt-8 [&_h1]:border-b-2 [&_h1]:border-[#2C4A5E] [&_h1]:pb-3 [&_h1]:font-serif [&_h1]:text-4xl [&_h1]:font-bold [&_h1]:text-[#2C4A5E] [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-[#2C4A5E] [&_h3]:mt-6 [&_h3]:font-serif [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-[#2C4A5E] [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_p]:leading-relaxed [&_p]:text-[#2C4A5E] [&_strong]:font-semibold [&_strong]:text-[#2C4A5E] [&_table]:mt-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border-b [&_td]:border-[#2C4A5E]/40 [&_td]:py-2 [&_td]:pr-4 [&_th]:border-b-2 [&_th]:border-[#2C4A5E] [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-mono [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-[#2C4A5E]/80 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </div>
  );
}
