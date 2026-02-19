import { describe, it, expect, vi } from 'vitest'
import { resolveAuthors } from '../../../src/lib/resolve-authors.js'

function createMockDb(
  usersRows: Record<string, unknown>[],
  profileRows: Record<string, unknown>[]
) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
  }
  selectChain.where.mockResolvedValueOnce(usersRows).mockResolvedValueOnce(profileRows)

  return {
    select: vi.fn().mockReturnValue(selectChain),
  }
}

describe('resolveAuthors', () => {
  const didAlice = 'did:plc:alice111'
  const didBob = 'did:plc:bob222'
  const communityDid = 'did:plc:community123'

  it('returns empty map for empty DID list', async () => {
    const db = createMockDb([], [])
    const result = await resolveAuthors([], null, db as never)
    expect(result.size).toBe(0)
    expect(db.select).not.toHaveBeenCalled()
  })

  it('resolves profiles from users table with no community context', async () => {
    const db = createMockDb(
      [
        {
          did: didAlice,
          handle: 'alice.bsky.social',
          displayName: 'Alice',
          avatarUrl: 'https://cdn.example.com/alice.jpg',
          bannerUrl: null,
          bio: null,
        },
        {
          did: didBob,
          handle: 'bob.bsky.social',
          displayName: null,
          avatarUrl: null,
          bannerUrl: null,
          bio: null,
        },
      ],
      []
    )

    const result = await resolveAuthors([didAlice, didBob], null, db as never)

    expect(result.size).toBe(2)
    expect(result.get(didAlice)).toEqual({
      did: didAlice,
      handle: 'alice.bsky.social',
      displayName: 'Alice',
      avatarUrl: 'https://cdn.example.com/alice.jpg',
    })
    expect(result.get(didBob)).toEqual({
      did: didBob,
      handle: 'bob.bsky.social',
      displayName: null,
      avatarUrl: null,
    })
  })

  it('applies community profile overrides when communityDid is provided', async () => {
    const db = createMockDb(
      [
        {
          did: didAlice,
          handle: 'alice.bsky.social',
          displayName: 'Alice',
          avatarUrl: 'https://cdn.example.com/alice.jpg',
          bannerUrl: null,
          bio: null,
        },
      ],
      [
        {
          did: didAlice,
          communityDid,
          displayName: 'Alice in Community',
          avatarUrl: 'https://cdn.example.com/alice-community.jpg',
          bannerUrl: null,
          bio: null,
        },
      ]
    )

    const result = await resolveAuthors([didAlice], communityDid, db as never)

    expect(result.get(didAlice)).toEqual({
      did: didAlice,
      handle: 'alice.bsky.social',
      displayName: 'Alice in Community',
      avatarUrl: 'https://cdn.example.com/alice-community.jpg',
    })
  })

  it('deduplicates DIDs before querying', async () => {
    const db = createMockDb(
      [
        {
          did: didAlice,
          handle: 'alice.bsky.social',
          displayName: 'Alice',
          avatarUrl: null,
          bannerUrl: null,
          bio: null,
        },
      ],
      []
    )

    const result = await resolveAuthors([didAlice, didAlice, didAlice], null, db as never)

    expect(result.size).toBe(1)
  })

  it('returns fallback for DIDs not found in users table', async () => {
    const db = createMockDb([], [])

    const result = await resolveAuthors([didAlice], null, db as never)

    expect(result.get(didAlice)).toEqual({
      did: didAlice,
      handle: didAlice,
      displayName: null,
      avatarUrl: null,
    })
  })
})
