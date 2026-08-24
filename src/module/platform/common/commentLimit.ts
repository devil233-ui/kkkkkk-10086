const DEFAULT_COMMENT_LIMIT = 5

/**
 * Resolve a configured comment count without treating 0 as an absent value.
 * A non-positive or invalid result disables comment fetching.
 */
export const resolveCommentLimit = (
  preferred: number | undefined,
  legacy: number | undefined
): number => {
  const configured = preferred ?? legacy ?? DEFAULT_COMMENT_LIMIT
  if (!Number.isFinite(configured) || configured <= 0) return 0
  return Math.floor(configured)
}
