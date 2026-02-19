// ---------------------------------------------------------------------------
// OAuth scope constants for AT Protocol granular authorization.
//
// AT Protocol OAuth supports per-collection scope strings (e.g.,
// `repo:forum.barazo.topic.post`) to limit access to specific record types.
// Barazo requests only the minimum scopes needed for its functionality.
//
// Older PDS implementations may not support granular scopes. In that case,
// the `transition:generic` fallback grants full repo access (same as legacy).
// ---------------------------------------------------------------------------

/** Base scopes for core Barazo forum operations (read/write own forum records). */
export const BARAZO_BASE_SCOPES =
  'atproto repo:forum.barazo.topic.post repo:forum.barazo.topic.reply repo:forum.barazo.interaction.reaction'

/** Additional scopes needed for cross-posting to Bluesky and Frontpage. */
export const CROSSPOST_ADDITIONAL_SCOPES =
  'repo:app.bsky.feed.post?action=create repo:fyi.frontpage.post?action=create blob:image/*'

/** Combined scopes for base + cross-posting. */
export const BARAZO_CROSSPOST_SCOPES = `${BARAZO_BASE_SCOPES} ${CROSSPOST_ADDITIONAL_SCOPES}`

/** Legacy fallback for PDS implementations that don't support granular scopes. */
export const FALLBACK_SCOPE = 'atproto transition:generic'

/**
 * Check whether a granted scope string includes cross-post permissions.
 * Returns true if the scope includes both Bluesky and Frontpage collections,
 * or if it's the legacy `transition:generic` fallback (which grants everything).
 */
export function hasCrossPostScopes(scope: string): boolean {
  if (isFallbackScope(scope)) {
    return true
  }
  return scope.includes('repo:app.bsky.feed.post') && scope.includes('repo:fyi.frontpage.post')
}

/**
 * Check whether a scope string is the legacy `transition:generic` fallback.
 */
export function isFallbackScope(scope: string): boolean {
  return scope.includes('transition:generic')
}
