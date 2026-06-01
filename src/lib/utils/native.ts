/**
 * Native-JS replacements for the small subset of lodash helpers we used.
 * Lifted in PR `chore/deps-and-bundle-hygiene` so we could drop the full
 * `lodash` bundle (~70KB min) from the client payload.
 *
 * Each helper documents the lodash semantics it replaces. If you find a
 * call site that needs richer semantics than what's here, prefer adding
 * a focused helper here over pulling lodash back in.
 */

/**
 * Split an array into chunks of `size`. Mirrors `_.chunk` for our usage
 * (positive integer size, last chunk may be smaller). Returns an empty
 * array if `size <= 0`, matching lodash.
 */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (!Array.isArray(arr) || size <= 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Deep structural equality, used only as a React.memo comparator for
 * prop bags (plain objects / arrays / primitives — no Maps/Sets/Dates).
 * Sufficient for our memo call sites which compare query-key-shaped
 * props; lodash's full `_.isEqual` handles many more types we don't use.
 */
export function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!isEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    const k = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!isEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Capitalize first character, leave the rest untouched. Replaces
 * `_.capitalize` for our usage (we never relied on lodash's behavior of
 * also lowercasing the tail — that's a separate `lowerCase` call when
 * needed).
 *
 * Note: `_.capitalize('foo BAR')` returns `'Foo bar'`. Ours returns
 * `'Foo BAR'`. Call sites that need the lodash behavior pipe through
 * `lowerCase` first.
 */
export function capitalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Lowercase, with non-alphanumeric runs collapsed to single spaces.
 * Mirrors `_.lowerCase('FOO_BAR') === 'foo bar'`.
 */
export function lowerCase(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Uppercase everything. Matches `_.toUpper`. Null/undefined → ''. */
export function toUpper(s: string | null | undefined): string {
  return s ? s.toUpperCase() : '';
}

/** Mirrors `_.snakeCase('fooBar') === 'foo_bar'`. */
export function snakeCase(s: string | null | undefined): string {
  return lowerCase(s).replace(/\s+/g, '_');
}

/** Mirrors `_.kebabCase('fooBar') === 'foo-bar'`. */
export function kebabCase(s: string | null | undefined): string {
  return lowerCase(s).replace(/\s+/g, '-');
}

/**
 * Mirrors `_.uniq` for string/number arrays — dedupes by reference
 * equality. Sufficient for our call site
 * (src/lib/convertMentionUsernamesToIds.ts) where the input is a
 * `string[]` of usernames/IDs.
 */
export function uniq<T>(arr: readonly T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Mirrors `_.startCase('foo_bar') === 'Foo Bar'`. Splits on word
 * boundaries then capitalizes each token.
 */
export function startCase(s: string | null | undefined): string {
  return lowerCase(s)
    .split(' ')
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(' ');
}
