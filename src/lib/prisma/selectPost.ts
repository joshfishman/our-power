import { includeUserSummary } from './includeUserSummary';

export const selectPost = (userId: string | undefined) => ({
  id: true,
  content: true,
  createdAt: true,
  ...includeUserSummary(),
  visualMedia: true,
  /**
   * Use postLikes to store the <PostLike>'s id of the user to the Post.
   * If there is a <PostLike> id, that means the user requesting has
   * liked the Post.
   */
  postLikes: {
    select: {
      id: true,
    },
    // An anonymous reader has liked nothing. The guard matters: Prisma DROPS
    // an `undefined` filter value, so `where: { userId: undefined }` would
    // match every like row and render every post as already-liked. `id: -1`
    // never matches an autoincrement primary key.
    where: userId ? { userId } : { id: -1 },
  },
  _count: {
    select: {
      postLikes: true,
      comments: true,
    },
  },
});
