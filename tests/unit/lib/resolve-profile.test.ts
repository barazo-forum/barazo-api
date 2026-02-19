import { describe, it, expect } from 'vitest'
import {
  resolveProfile,
  type SourceProfile,
  type CommunityOverride,
} from '../../../src/lib/resolve-profile.js'

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

const baseSource: SourceProfile = {
  did: 'did:plc:abc123',
  handle: 'alice.bsky.social',
  displayName: 'Alice',
  avatarUrl: 'https://cdn.example.com/avatar.jpg',
  bannerUrl: 'https://cdn.example.com/banner.jpg',
  bio: 'Hello from the AT Protocol',
}

describe('resolveProfile', () => {
  it('returns source profile values when override is null', () => {
    const result = resolveProfile(baseSource, null)

    expect(result).toEqual({
      did: 'did:plc:abc123',
      handle: 'alice.bsky.social',
      displayName: 'Alice',
      avatarUrl: 'https://cdn.example.com/avatar.jpg',
      bannerUrl: 'https://cdn.example.com/banner.jpg',
      bio: 'Hello from the AT Protocol',
    })
  })

  it('uses all override values when every field is set', () => {
    const override: CommunityOverride = {
      displayName: 'Alice in Wonderland',
      avatarUrl: 'https://cdn.example.com/community-avatar.jpg',
      bannerUrl: 'https://cdn.example.com/community-banner.jpg',
      bio: 'Community-specific bio',
    }

    const result = resolveProfile(baseSource, override)

    expect(result).toEqual({
      did: 'did:plc:abc123',
      handle: 'alice.bsky.social',
      displayName: 'Alice in Wonderland',
      avatarUrl: 'https://cdn.example.com/community-avatar.jpg',
      bannerUrl: 'https://cdn.example.com/community-banner.jpg',
      bio: 'Community-specific bio',
    })
  })

  it('falls back to source for null override fields', () => {
    const override: CommunityOverride = {
      displayName: 'Community Alice',
      avatarUrl: null,
      bannerUrl: null,
      bio: 'Override bio only',
    }

    const result = resolveProfile(baseSource, override)

    expect(result).toEqual({
      did: 'did:plc:abc123',
      handle: 'alice.bsky.social',
      displayName: 'Community Alice',
      avatarUrl: 'https://cdn.example.com/avatar.jpg',
      bannerUrl: 'https://cdn.example.com/banner.jpg',
      bio: 'Override bio only',
    })
  })

  it('returns all nulls for nullable fields when source is all null and no override', () => {
    const nullSource: SourceProfile = {
      did: 'did:plc:empty',
      handle: 'empty.bsky.social',
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    }

    const result = resolveProfile(nullSource, null)

    expect(result).toEqual({
      did: 'did:plc:empty',
      handle: 'empty.bsky.social',
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    })
  })

  it('uses override values when source nullable fields are all null', () => {
    const nullSource: SourceProfile = {
      did: 'did:plc:empty',
      handle: 'empty.bsky.social',
      displayName: null,
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    }

    const override: CommunityOverride = {
      displayName: 'Community Name',
      avatarUrl: 'https://cdn.example.com/override-avatar.jpg',
      bannerUrl: 'https://cdn.example.com/override-banner.jpg',
      bio: 'Override bio',
    }

    const result = resolveProfile(nullSource, override)

    expect(result).toEqual({
      did: 'did:plc:empty',
      handle: 'empty.bsky.social',
      displayName: 'Community Name',
      avatarUrl: 'https://cdn.example.com/override-avatar.jpg',
      bannerUrl: 'https://cdn.example.com/override-banner.jpg',
      bio: 'Override bio',
    })
  })

  it('always takes did and handle from source, never from override', () => {
    const override: CommunityOverride = {
      displayName: 'Override Name',
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
    }

    const result = resolveProfile(baseSource, override)

    expect(result.did).toBe(baseSource.did)
    expect(result.handle).toBe(baseSource.handle)
  })
})
