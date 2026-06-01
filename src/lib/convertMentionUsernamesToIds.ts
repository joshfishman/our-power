import 'server-only';
// Replaced `from 'lodash'` import; see src/lib/utils/native.ts (chore/deps-and-bundle-hygiene).
import { uniq } from './utils/native';
import prisma from './prisma/prisma';

/**
 * Converts the `@` `username` mentions to the `id`s of the users. It is
 * crucial to store the `@` mentions with the users' `id`s as the `username`
 * can change.
 *
 * @param str The string to process.
 * @param reverse Whether to convert the other way around - `id` to `username`.
 * @returns { str: string; usersMentioned?: { id: string; username: string | null; }[]; }
 */
export async function convertMentionUsernamesToIds({
  str,
  reverse = false,
}: {
  str: string;
  reverse?: boolean;
}): Promise<{
  str: string;
  usersMentioned?: {
    id: string;
    username: string | null;
  }[];
}> {
  const pattern = /(^|\s)(@)(\w+|\w+)/g;
  const matches = str.match(pattern)?.map((match) => match.slice(match.charAt(1) === '@' ? 2 : 1));

  // If there are no `@` mentions return the original string
  if (!matches) return { str };

  // The `matchesUnique` can either be the id/username of the mentioned users
  const matchesUnique = uniq(matches);
  const usersMentioned = await prisma.user.findMany({
    where: {
      ...(!reverse
        ? {
            username: {
              in: matchesUnique,
            },
          }
        : {
            id: {
              in: matchesUnique,
            },
          }),
    },
    select: {
      id: true,
      username: true,
    },
  });

  // Replace the matches with the id/username of the users
  const res = str.replace(pattern, (match, space, char, word) => {
    const user = usersMentioned.find((um) => (!reverse ? um.username : um.id) === word);
    return `${space}${char}${user ? (!reverse ? user.id : user.username) : word}`;
  });

  return {
    str: res,
    usersMentioned,
  };
}

export async function convertMentionsBatch({
  strings,
  reverse = false,
}: {
  strings: string[];
  reverse?: boolean;
}): Promise<string[]> {
  const pattern = /(^|\s)(@)(\w+|\w+)/g;
  const matches = strings.flatMap(
    (value) => value.match(pattern)?.map((match) => match.slice(match.charAt(1) === '@' ? 2 : 1)) || [],
  );

  if (matches.length === 0) return strings;

  const matchesUnique = uniq(matches);
  const usersMentioned = await prisma.user.findMany({
    where: {
      ...(!reverse
        ? {
            username: {
              in: matchesUnique,
            },
          }
        : {
            id: {
              in: matchesUnique,
            },
          }),
    },
    select: {
      id: true,
      username: true,
    },
  });

  return strings.map((value) =>
    value.replace(pattern, (match, space, char, word) => {
      const user = usersMentioned.find((um) => (!reverse ? um.username : um.id) === word);
      return `${space}${char}${user ? (!reverse ? user.id : user.username) : word}`;
    }),
  );
}
