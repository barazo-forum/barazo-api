export interface SourceProfile {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
}

export interface CommunityOverride {
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
}

export interface ResolvedProfile {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
}

/**
 * Resolve a user's profile for display in a community context.
 * Community override fields take precedence; null means "use source."
 */
export function resolveProfile(
  source: SourceProfile,
  override: CommunityOverride | null,
): ResolvedProfile {
  if (!override) {
    return {
      did: source.did,
      handle: source.handle,
      displayName: source.displayName,
      avatarUrl: source.avatarUrl,
      bannerUrl: source.bannerUrl,
      bio: source.bio,
    };
  }

  return {
    did: source.did,
    handle: source.handle,
    displayName: override.displayName ?? source.displayName,
    avatarUrl: override.avatarUrl ?? source.avatarUrl,
    bannerUrl: override.bannerUrl ?? source.bannerUrl,
    bio: override.bio ?? source.bio,
  };
}
