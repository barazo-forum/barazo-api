import { describe, it, expect } from 'vitest'
import { sanitizeHtml, sanitizeText } from '../../../src/lib/sanitize.js'

describe('sanitize', () => {
  describe('sanitizeHtml', () => {
    it('returns empty string for empty input', () => {
      expect(sanitizeHtml('')).toBe('')
    })

    it('preserves valid markdown-rendered HTML tags', () => {
      const input =
        '<p>Hello <strong>bold</strong> and <em>italic</em></p>' +
        '<blockquote>A quote</blockquote>' +
        '<ul><li>Item</li></ul>' +
        '<ol><li>Numbered</li></ol>' +
        '<pre><code>code block</code></pre>' +
        '<h1>Heading</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>' +
        '<hr>' +
        '<table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>' +
        '<del>strikethrough</del><sup>sup</sup><sub>sub</sub><br>'
      const result = sanitizeHtml(input)
      // All these tags should survive
      expect(result).toContain('<strong>')
      expect(result).toContain('<em>')
      expect(result).toContain('<blockquote>')
      expect(result).toContain('<ul>')
      expect(result).toContain('<ol>')
      expect(result).toContain('<li>')
      expect(result).toContain('<pre>')
      expect(result).toContain('<code>')
      expect(result).toContain('<h1>')
      expect(result).toContain('<table>')
      expect(result).toContain('<del>')
      expect(result).toContain('<sup>')
      expect(result).toContain('<sub>')
      expect(result).toContain('<br>')
      expect(result).toContain('<hr>')
    })

    it('preserves allowed attributes on links', () => {
      const input = '<a href="https://example.com" rel="noopener noreferrer">Link</a>'
      const result = sanitizeHtml(input)
      expect(result).toContain('href="https://example.com"')
      expect(result).toContain('rel="noopener noreferrer"')
    })

    it('preserves img tags with src and alt', () => {
      const input = '<img src="https://example.com/img.png" alt="Photo">'
      const result = sanitizeHtml(input)
      expect(result).toContain('src="https://example.com/img.png"')
      expect(result).toContain('alt="Photo"')
    })

    it('strips script tags', () => {
      const input = '<p>Hello</p><script>alert("xss")</script>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('alert')
      expect(result).toContain('<p>Hello</p>')
    })

    it('strips onerror attributes from img tags', () => {
      const input = '<img src="x" onerror="alert(1)">'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('onerror')
      expect(result).not.toContain('alert')
    })

    it('strips javascript: protocol from href', () => {
      const input = '<a href="javascript:alert(1)">click</a>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('javascript:')
    })

    it('strips iframe tags', () => {
      const input = '<iframe src="https://evil.com"></iframe><p>Safe</p>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('<iframe')
      expect(result).toContain('<p>Safe</p>')
    })

    it('strips style tags', () => {
      const input = '<style>body { display: none }</style><p>Visible</p>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('<style')
      expect(result).toContain('<p>Visible</p>')
    })

    it('strips data attributes', () => {
      const input = '<p data-tracking="abc123">Text</p>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('data-tracking')
      expect(result).toContain('Text')
    })

    it('strips on* event handler attributes', () => {
      const input = '<p onclick="alert(1)" onmouseover="alert(2)">Text</p>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('onclick')
      expect(result).not.toContain('onmouseover')
    })

    it('strips form and input tags', () => {
      const input = '<form action="/steal"><input type="text"><button>Submit</button></form>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('<form')
      expect(result).not.toContain('<input')
    })

    it('applies NFC normalization', () => {
      // U+0065 (e) + U+0301 (combining acute accent) = NFD form of e-acute
      // NFC normalizes to U+00E9 (e-acute precomposed)
      const nfd = 'caf\u0065\u0301' // "café" in NFD
      const nfc = 'caf\u00E9' // "café" in NFC
      const result = sanitizeHtml(`<p>${nfd}</p>`)
      expect(result).toContain(nfc)
    })

    it('strips bidirectional override characters', () => {
      // U+202A (LRE), U+202B (RLE), U+202C (PDF), U+202D (LRO), U+202E (RLO)
      // U+2066 (LRI), U+2067 (RLI), U+2068 (FSI), U+2069 (PDI)
      // U+200E (LRM), U+200F (RLM)
      const bidiChars = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200E\u200F'
      const input = `<p>Hello${bidiChars}World</p>`
      const result = sanitizeHtml(input)
      expect(result).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/)
      expect(result).toContain('HelloWorld')
    })

    it('handles combined bidi + script injection', () => {
      const input = '<p>\u202EHello</p><script>alert("xss")</script>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('\u202E')
    })

    it('handles very large input without throwing', () => {
      const large = '<p>' + 'A'.repeat(100_000) + '</p>'
      const result = sanitizeHtml(large)
      expect(result).toContain('<p>')
      expect(result.length).toBeGreaterThan(0)
    })

    it('preserves plain text without modification (after normalization)', () => {
      const input = 'Just plain text with no HTML'
      const result = sanitizeHtml(input)
      expect(result).toBe('Just plain text with no HTML')
    })
  })

  describe('sanitizeText', () => {
    it('returns empty string for empty input', () => {
      expect(sanitizeText('')).toBe('')
    })

    it('strips all HTML tags', () => {
      const input = '<b>Bold</b> and <script>evil()</script>'
      const result = sanitizeText(input)
      expect(result).not.toContain('<')
      expect(result).not.toContain('>')
      expect(result).toContain('Bold')
      expect(result).not.toContain('evil')
    })

    it('preserves plain text', () => {
      const input = 'How to configure PostgreSQL?'
      expect(sanitizeText(input)).toBe('How to configure PostgreSQL?')
    })

    it('applies NFC normalization', () => {
      const nfd = 'caf\u0065\u0301'
      const nfc = 'caf\u00E9'
      expect(sanitizeText(nfd)).toBe(nfc)
    })

    it('strips bidirectional override characters', () => {
      const input = '\u202AHello\u202E World\u200F'
      const result = sanitizeText(input)
      expect(result).toBe('Hello World')
    })

    it('strips HTML from titles with injection attempts', () => {
      const input = 'Topic <img src=x onerror=alert(1)> Title'
      const result = sanitizeText(input)
      expect(result).not.toContain('<img')
      expect(result).not.toContain('onerror')
      expect(result).toContain('Topic')
      expect(result).toContain('Title')
    })

    it('handles very large input without throwing', () => {
      const large = 'A'.repeat(100_000)
      const result = sanitizeText(large)
      expect(result.length).toBe(100_000)
    })

    it('strips nested HTML tags', () => {
      const input = '<div><p><b>Nested</b></p></div>'
      const result = sanitizeText(input)
      expect(result).not.toContain('<')
      expect(result).toContain('Nested')
    })

    it('handles homoglyph-style text (NFC normalization of composed chars)', () => {
      // Latin Small Letter A with Ring Above: U+0061 + U+030A -> U+00E5
      const decomposed = '\u0061\u030A'
      const composed = '\u00E5'
      expect(sanitizeText(decomposed)).toBe(composed)
    })
  })
})
