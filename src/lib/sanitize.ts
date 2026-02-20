import DOMPurify from 'isomorphic-dompurify'

/**
 * Bidirectional override and mark characters to strip from all text.
 * Prevents text reordering attacks (bidi override) and invisible direction marks.
 */
const BIDI_REGEX = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g

/** Tags allowed in forum content (markdown-rendered HTML). */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'a',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'del',
  'sup',
  'sub',
  'span',
]

/** Attributes allowed on permitted tags. */
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'class', 'rel', 'target']

/**
 * Apply Unicode NFC normalization and strip bidirectional override characters.
 */
function normalizeText(input: string): string {
  return input.normalize('NFC').replace(BIDI_REGEX, '')
}

/**
 * Sanitize HTML content for storage. Allows safe markdown-rendered tags.
 * Applies NFC normalization and strips bidi override characters.
 *
 * Use for topic content and reply content fields.
 */
export function sanitizeHtml(input: string): string {
  if (input === '') return ''

  const normalized = normalizeText(input)

  return DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}

/**
 * Sanitize plain text (strip all HTML). Used for topic titles.
 * Applies NFC normalization and strips bidi override characters.
 */
export function sanitizeText(input: string): string {
  if (input === '') return ''

  const normalized = normalizeText(input)

  return DOMPurify.sanitize(normalized, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  })
}
