import { randomUUID } from 'node:crypto'
import { marked, type Token, type Tokens } from 'marked'

export type NoteBody = { html: string; bodyLength: number }

type Rendered = { html: string; text: string }

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const join = (items: readonly Rendered[]): Rendered => ({
  html: items.map((i) => i.html).join(''),
  text: items.map((i) => i.text).join(''),
})

const safeHref = (href: string): string | undefined =>
  /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : undefined

const rawOf = (token: Token): string =>
  'raw' in token && typeof token.raw === 'string' ? token.raw : ''

const inline = (tokens: readonly Token[]): Rendered =>
  join(
    tokens.map((token): Rendered => {
      switch (token.type) {
        case 'strong': {
          const inner = inline((token as Tokens.Strong).tokens)
          return { html: `<strong>${inner.html}</strong>`, text: inner.text }
        }
        case 'em': {
          const inner = inline((token as Tokens.Em).tokens)
          return { html: `<em>${inner.html}</em>`, text: inner.text }
        }
        case 'del': {
          const inner = inline((token as Tokens.Del).tokens)
          return { html: `<s>${inner.html}</s>`, text: inner.text }
        }
        case 'codespan': {
          const { text } = token as Tokens.Codespan
          return { html: `<code>${escapeHtml(text)}</code>`, text }
        }
        case 'br':
          return { html: '<br>', text: '\n' }
        case 'link': {
          const link = token as Tokens.Link
          const inner = inline(link.tokens)
          const href = safeHref(link.href)
          return href
            ? { html: `<a href="${escapeHtml(href)}">${inner.html}</a>`, text: inner.text }
            : inner
        }
        case 'image': {
          // 画像は対象外。代替テキストのみ残す。
          const alt = (token as Tokens.Image).text
          return { html: escapeHtml(alt), text: alt }
        }
        case 'text': {
          const t = token as Tokens.Text
          return t.tokens ? inline(t.tokens) : { html: escapeHtml(t.text), text: t.text }
        }
        case 'escape': {
          const { text } = token as Tokens.Escape
          return { html: escapeHtml(text), text }
        }
        default: {
          const raw = rawOf(token)
          return { html: escapeHtml(raw), text: raw }
        }
      }
    }),
  )

const open = (tag: string): string => {
  const id = randomUUID()
  return `<${tag} name="${id}" id="${id}">`
}

const listItem = (item: Tokens.ListItem): Rendered => {
  const inner = join(
    item.tokens.map((t): Rendered => {
      if (t.type === 'list') return list(t as Tokens.List)
      if (t.type === 'text' || t.type === 'paragraph') {
        return inline((t as Tokens.Text | Tokens.Paragraph).tokens ?? [])
      }
      return inline([t])
    }),
  )
  return { html: `<li>${inner.html}</li>`, text: inner.text }
}

const list = (token: Tokens.List): Rendered => {
  const tag = token.ordered ? 'ol' : 'ul'
  const items = join(token.items.map(listItem))
  return { html: `${open(tag)}${items.html}</${tag}>`, text: items.text }
}

const block = (token: Token): Rendered => {
  switch (token.type) {
    case 'space':
      return { html: '', text: '' }
    case 'heading': {
      const h = token as Tokens.Heading
      const tag = h.depth <= 2 ? 'h2' : 'h3'
      const inner = inline(h.tokens)
      return { html: `${open(tag)}${inner.html}</${tag}>`, text: inner.text }
    }
    case 'paragraph': {
      const inner = inline((token as Tokens.Paragraph).tokens)
      return { html: `${open('p')}${inner.html}</p>`, text: inner.text }
    }
    case 'text': {
      const t = token as Tokens.Text
      const inner = t.tokens ? inline(t.tokens) : { html: escapeHtml(t.text), text: t.text }
      return { html: `${open('p')}${inner.html}</p>`, text: inner.text }
    }
    case 'list':
      return list(token as Tokens.List)
    case 'blockquote': {
      const inner = join((token as Tokens.Blockquote).tokens.map(block))
      return { html: `${open('blockquote')}${inner.html}</blockquote>`, text: inner.text }
    }
    case 'code': {
      const { text } = token as Tokens.Code
      return { html: `${open('pre')}<code>${escapeHtml(text)}</code></pre>`, text }
    }
    case 'hr':
      return { html: open('hr'), text: '' }
    default: {
      // table / html などは対象外。生テキストを段落として残す（HTML は実行されない）。
      const raw = rawOf(token).trim()
      return raw
        ? { html: `${open('p')}${escapeHtml(raw)}</p>`, text: raw }
        : { html: '', text: '' }
    }
  }
}

/** Markdown を note の下書き本文 HTML と本文テキスト長に変換する。 */
export const markdownToNoteBody = (markdown: string): NoteBody => {
  const rendered = join(marked.lexer(markdown).map(block))
  return { html: rendered.html, bodyLength: rendered.text.length }
}

/** 既存 HTML の本文テキスト長（タグ除去による近似）。 */
export const htmlTextLength = (html: string): number =>
  html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&').length
