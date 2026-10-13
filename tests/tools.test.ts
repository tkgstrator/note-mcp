import { describe, expect, test } from 'bun:test'
import { createNoteClient } from '../src/client'
import { createHandlers } from '../src/tools'

type Call = { url: string; method: string; body: unknown }

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

const setup = (routes: Record<string, () => Response>) => {
  const calls: Call[] = []
  const client = createNoteClient({
    session: 'DUMMY_SESSION',
    now: () => 1,
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET'
      calls.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      const route = Object.entries(routes).find(([key]) =>
        key.includes(' ') ? `${method} ${url.split('?')[0]}` === key : url.includes(key),
      )
      return route ? route[1]() : json({}, 404)
    },
  })
  return { calls, handlers: createHandlers(client) }
}

const text = (r: { content: { text: string }[] }): string => r.content[0]?.text ?? ''

describe('tool handlers', () => {
  test('note_create_draft は作成+保存し編集 URL を返す', async () => {
    const { calls, handlers } = setup({
      'POST https://note.com/api/v1/text_notes?': () => json({}, 500),
      'POST https://note.com/api/v1/text_notes': () => json({ data: { id: 5, key: 'nkey' } }, 201),
      draft_save: () => json({ data: { result: true, updated_at: 'now' } }, 201),
    })
    const result = await handlers.note_create_draft({ title: 'T', markdown: 'hello' })
    expect(result.isError).toBeUndefined()
    const out = JSON.parse(text(result))
    expect(out).toEqual({
      id: 5,
      key: 'nkey',
      editUrl: 'https://editor.note.com/notes/nkey/edit/',
      updatedAt: 'now',
    })
    const save = calls[1]
    expect(save?.url).toContain('draft_save?id=5')
    expect(save?.body).toMatchObject({ name: 'T', body_length: 5 })
  })

  test('note_update_draft は key 指定で未指定項目を引き継ぐ', async () => {
    const { calls, handlers } = setup({
      'GET https://note.com/api/v3/notes/nk': () =>
        json({ data: { id: 9, key: 'nk', name: 'Old', body: '<p>abc</p>' } }),
      draft_save: () => json({ data: { result: true } }, 201),
    })
    const result = await handlers.note_update_draft({ key: 'nk', title: 'New' })
    expect(result.isError).toBeUndefined()
    expect(calls[1]?.body).toEqual({ name: 'New', body: '<p>abc</p>', body_length: 3 })
  })

  test.each([
    { label: 'id が不一致', current: { id: 9, key: 'nk', name: 'Old', body: '<p>abc</p>' } },
    { label: 'id が不明', current: { key: 'nk', name: 'Old', body: '<p>abc</p>' } },
  ])('note_update_draft は key と id の $label なら保存しない', async ({ current }) => {
    const { calls, handlers } = setup({
      'GET https://note.com/api/v3/notes/nk': () => json({ data: current }),
      draft_save: () => json({ data: { result: true } }, 201),
    })
    const result = await handlers.note_update_draft({ key: 'nk', id: 10, title: 'New' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('同じ下書きであることを確認できません')
    expect(calls).toHaveLength(1)
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  test('note_update_draft は key と id が一致すれば保存する', async () => {
    const { calls, handlers } = setup({
      'GET https://note.com/api/v3/notes/nk': () =>
        json({ data: { id: 9, key: 'nk', name: 'Old', body: '<p>abc</p>' } }),
      draft_save: () => json({ data: { result: true } }, 201),
    })
    const result = await handlers.note_update_draft({ key: 'nk', id: 9, title: 'New' })
    expect(result.isError).toBeUndefined()
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toContain('draft_save?id=9')
    expect(calls[1]?.body).toEqual({ name: 'New', body: '<p>abc</p>', body_length: 3 })
  })

  test('note_update_draft は引数不足をエラーにする', async () => {
    const { handlers } = setup({})
    expect((await handlers.note_update_draft({ title: 'x' })).isError).toBe(true)
    expect((await handlers.note_update_draft({ key: 'k' })).isError).toBe(true)
  })

  test('401 は isError で分かるメッセージ、Cookie 値は出ない', async () => {
    const { handlers } = setup({ current_user: () => json({}, 401) })
    const result = await handlers.note_whoami()
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('NOTE_SESSIONを更新してください')
    expect(text(result)).not.toContain('DUMMY_SESSION')
  })

  test('note_list_drafts は検証済みの形を返し、形が違えばエラー', async () => {
    const good = setup({
      note_list: () =>
        json({
          data: {
            notes: [
              {
                id: 1,
                key: 'n1',
                status: 'draft',
                name: null,
                noteDraft: { id: '9', name: 'a', updatedAt: 't' },
              },
            ],
            isLastPage: false,
            totalCount: 30,
          },
        }),
    })
    const out = JSON.parse(text(await good.handlers.note_list_drafts({ page: 1 })))
    expect(out.notice).toBeUndefined()
    expect(out.isLastPage).toBe(false)
    expect(out.totalCount).toBe(30)
    expect(out.drafts[0]).toEqual({
      id: 1,
      key: 'n1',
      title: 'a',
      updatedAt: 't',
      status: 'draft',
      editUrl: 'https://editor.note.com/notes/n1/edit/',
    })
    const bad = setup({ note_list: () => json({ data: { contents: [] } }) })
    const result = await bad.handlers.note_list_drafts({ page: 1 })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('形式が想定と異なります')
  })

  test('note_delete_draft', async () => {
    const { calls, handlers } = setup({ draft_delete: () => new Response(null, { status: 200 }) })
    const out = JSON.parse(text(await handlers.note_delete_draft({ id: 3 })))
    expect(out).toEqual({ deleted: true, id: 3 })
    expect(calls[0]?.method).toBe('DELETE')
  })
})
