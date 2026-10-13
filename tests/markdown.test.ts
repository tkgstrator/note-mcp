import { describe, expect, test } from 'bun:test'
import { htmlTextLength, markdownToNoteBody } from '../src/markdown'

const idPattern = /<(\w+) name="([0-9a-f-]{36})" id="\2">/g

describe('markdownToNoteBody', () => {
  test('見出しは h2/h3 に正規化され、各ブロックに name/id が付く', () => {
    const { html } = markdownToNoteBody('# A\n\n## B\n\n### C\n\n#### D\n\ntext')
    const tags = [...html.matchAll(idPattern)].map((m) => m[1])
    expect(tags).toEqual(['h2', 'h2', 'h3', 'h3', 'p'])
    const ids = [...html.matchAll(idPattern)].map((m) => m[2])
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('段落内の太字/斜体/リンク/コード', () => {
    const { html } = markdownToNoteBody('**b** *i* [l](https://example.com) `c`')
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<a href="https://example.com">l</a>')
    expect(html).toContain('<code>c</code>')
  })

  test('リスト・引用・コードブロック', () => {
    const { html } = markdownToNoteBody('- a\n- b\n\n1. x\n\n> q\n\n```\n<tag>\n```')
    expect(html).toMatch(/<ul [^>]*><li>a<\/li><li>b<\/li><\/ul>/)
    expect(html).toMatch(/<ol [^>]*><li>x<\/li><\/ol>/)
    expect(html).toMatch(/<blockquote [^>]*><p [^>]*>q<\/p><\/blockquote>/)
    expect(html).toMatch(/<pre [^>]*><code>&lt;tag&gt;<\/code><\/pre>/)
  })

  test('HTML はエスケープされ、危険なリンクは外される', () => {
    const { html } = markdownToNoteBody('<script>alert(1)</script>\n\n[x](javascript:alert(1))')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('javascript:')
  })

  test('body_length は装飾を除いた本文テキスト長', () => {
    expect(markdownToNoteBody('**ab** cd').bodyLength).toBe(5)
    expect(markdownToNoteBody('日本語').bodyLength).toBe(3)
    expect(markdownToNoteBody('').bodyLength).toBe(0)
  })
})

describe('htmlTextLength', () => {
  test('タグを除き実体参照を戻して数える', () => {
    expect(htmlTextLength('<p>a&amp;b</p>')).toBe(3)
  })
})
