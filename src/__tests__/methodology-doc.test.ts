import { describe, it, expect } from 'vitest';
import { stripUnpublishedSections } from '@/lib/scorecard/methodology-doc';

const DOC = [
  '# How we score',
  '',
  'Intro paragraph.',
  '',
  '## How it works',
  '',
  'Kept body.',
  '',
  '## Methodology versions',
  '',
  '| v1.0 | old |',
  '',
  '### v1.9 detail',
  '',
  'Nested churn.',
  '',
  '## Data sources & inventory',
  '',
  'Current sources.',
].join('\n');

describe('stripUnpublishedSections', () => {
  const out = stripUnpublishedSections(DOC);

  it('keeps the sections that describe what is currently true', () => {
    expect(out).toContain('## How it works');
    expect(out).toContain('Kept body.');
    expect(out).toContain('## Data sources & inventory');
    expect(out).toContain('Current sources.');
  });

  it('drops the version history', () => {
    expect(out).not.toContain('## Methodology versions');
    expect(out).not.toContain('| v1.0 | old |');
  });

  it('drops level-3 subsections nested inside a withheld section', () => {
    expect(out).not.toContain('### v1.9 detail');
    expect(out).not.toContain('Nested churn.');
  });

  it('resumes at the next level-2 heading rather than swallowing the rest', () => {
    expect(out.trimEnd().endsWith('Current sources.')).toBe(true);
  });

  it('leaves a doc with nothing to withhold unchanged apart from blank-line collapsing', () => {
    const clean = '# Title\n\n## Only section\n\nBody.';
    expect(stripUnpublishedSections(clean)).toBe(clean);
  });
});
