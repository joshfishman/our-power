/* eslint-disable react/no-children-prop */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getArticleBySlug, getAllArticles } from '@/lib/scorecard/articles';
import { getPlankBySlug } from '@/lib/scorecard/queries';

type Props = { params: Promise<{ slug: string }> };

// Articles are static content modules, so the set of valid slugs is known at
// build time.
export function generateStaticParams() {
  return getAllArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const article = getArticleBySlug(decodeURIComponent(params.slug));
  if (!article) return { title: 'Article not found | Scorecard' };
  return {
    title: `${article.title} | We the People Scorecard`,
    description: article.dek,
  };
}

const PROSE_CLASS =
  'mt-6 text-foreground [&_a]:text-accent [&_a]:underline hover:[&_a]:text-foreground [&_blockquote]:mt-4 [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:font-serif [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:mt-1 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_p]:leading-relaxed [&_p]:text-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6';

export default async function ArticlePage(props: Props) {
  const params = await props.params;
  const article = getArticleBySlug(decodeURIComponent(params.slug));
  if (!article) notFound();

  // Resolve the attached plank (federal record, for naming) so we can offer a
  // "back to the issue" link.
  const plank = article.plankSlug ? await getPlankBySlug('FEDERAL', article.plankSlug) : null;

  const formattedDate = new Date(`${article.publishedAt}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {plank ? (
          <Link
            href={`/scorecard/issues/${encodeURIComponent(plank.slug)}`}
            className="text-muted-foreground hover:text-foreground">
            ← Plank {plank.number}. {plank.name}
          </Link>
        ) : (
          <Link href="/scorecard/issues" className="text-muted-foreground hover:text-foreground">
            ← All issues
          </Link>
        )}
        {article.section === 'pac' && (
          <Link href="/scorecard/pac" className="text-muted-foreground hover:text-foreground">
            Corporate PAC scorecard →
          </Link>
        )}
      </div>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">
          {plank ? `Plank ${plank.number} — ${plank.name}` : 'Scorecard'}
        </p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-foreground">{article.title}</h1>
        <p className="mt-3 text-lg italic text-muted-foreground">{article.dek}</p>
        <p className="mt-3 font-mono text-xs uppercase tracking-wide text-subtle-foreground">{formattedDate}</p>
      </header>

      {article.chart ? (
        <section className="mt-8 rounded-lg border border-[#C8B98A]/30 bg-[#2C4A5E]/60 p-5">
          <h2 className="font-serif text-lg font-bold text-[#F5DEB3]">{article.chart.title}</h2>
          <ul className="mt-4 space-y-2.5">
            {article.chart.bars.map((b) => {
              const max = Math.max(...article.chart!.bars.map((x) => x.value), 1);
              const pct = Math.max(2, Math.round((100 * b.value) / max));
              const bar = b.tone === 'navy' ? 'bg-[#C8B98A]' : b.tone === 'muted' ? 'bg-[#F5DEB3]/30' : 'bg-[#8B3A3A]';
              return (
                <li key={b.label} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 font-mono text-xs text-[#F5DEB3]">{b.label}</span>
                  <span className="h-3 flex-1 overflow-hidden rounded bg-[#F5DEB3]/10">
                    <span className={`block h-full ${bar}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-xs font-bold text-[#F5DEB3]">
                    {b.valueLabel}
                  </span>
                </li>
              );
            })}
          </ul>
          {article.chart.caption ? (
            <p className="mt-3 border-t border-[#C8B98A]/20 pt-2 text-xs text-[#F5DEB3]/70">{article.chart.caption}</p>
          ) : null}
        </section>
      ) : null}

      <article className={PROSE_CLASS}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.body}</ReactMarkdown>
      </article>

      {article.cases && article.cases.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-serif text-2xl font-bold text-foreground">The races, and what the money bought</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Where the spending concentrated — the targeted member and how they stood, the backed winner and how they
            have voted since.
          </p>
          <div className="mt-4 space-y-4">
            {article.cases.map((c) => (
              <div key={c.race} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wide text-foreground">
                    {c.race}
                  </span>
                  <span className="font-mono text-xs font-bold text-[#8B3A3A]">{c.spend}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded border border-border bg-secondary p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">
                      Targeted — how they stood
                    </p>
                    <p className="mt-1 font-serif text-sm font-bold text-foreground">{c.targeted}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.targetedStance}</p>
                  </div>
                  <div className="rounded border border-[#8B3A3A]/40 bg-[#8B3A3A]/10 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-subtle-foreground">
                      Backed winner — how they voted
                    </p>
                    <p className="mt-1 font-serif text-sm font-bold text-foreground">{c.winner}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.winnerRecord}</p>
                  </div>
                </div>
                {c.sourceUrl ? (
                  <a
                    href={c.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block font-mono text-xs text-accent underline hover:text-foreground">
                    source ↗
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-12 border-t-2 border-border pt-6">
        <h2 className="font-mono text-xs uppercase tracking-widest text-foreground">Sources</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {article.sources.map((source, i) => (
            <li key={i} className="text-muted-foreground">
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline hover:text-foreground">
                  {source.label}
                </a>
              ) : (
                <span>{source.label}</span>
              )}
              {source.representative && (
                <span className="ml-2 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-foreground">
                  representative citation
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-subtle-foreground">
          Citations marked &ldquo;representative&rdquo; illustrate the kind of public record that documents this
          pattern; verify specific figures against the primary filings before quoting an exact number.
        </p>
      </section>
    </div>
  );
}
