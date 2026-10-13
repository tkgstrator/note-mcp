import { describe, expect, test } from 'bun:test'
import { createNoteClient, NoteApiError } from '../src/client'

type Call = { url: string; init: RequestInit | undefined }

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const setup = (respond: () => Response) => {
  const calls: Call[] = []
  const client = createNoteClient({
    session: 'DUMMY_SESSION',
    now: () => 1700000000000,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return respond()
    },
  })
  return { calls, client }
}

describe('note client', () => {
  test('共通ヘッダーと Cookie を付与する', async () => {
    const { calls, client } = setup(() => json({ data: { urlname: 'u', nickname: 'n', id: 1 } }))
    const user = await client.whoami()
    expect(user.urlname).toBe('u')
    expect(calls[0]?.url).toBe('https://note.com/api/v2/current_user')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('x-requested-with')).toBe('XMLHttpRequest')
    expect(headers.get('origin')).toBe('https://editor.note.com')
    expect(headers.get('referer')).toBe('https://editor.note.com/')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('cookie')).toBe('_note_session_v5=DUMMY_SESSION')
  })

  test.each([401, 403, 422])(
    '%d は Cookie 期限切れのエラーになる（値は含まない）',
    async (status) => {
      const { client } = setup(() => json({}, status))
      const error = await client.whoami().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(NoteApiError)
      expect(String((error as Error).message)).toContain('NOTE_SESSIONを更新してください')
      expect(String((error as Error).message)).not.toContain('DUMMY_SESSION')
    },
  )

  test('その他の失敗ステータス', async () => {
    const { client } = setup(() => json({}, 500))
    await expect(client.whoami()).rejects.toThrow(/HTTP 500/)
  })

  test('レスポンス形式が違えばエラー', async () => {
    const { client } = setup(() => json({ data: {} }))
    await expect(client.whoami()).rejects.toThrow(/形式が想定と異なります/)
  })

  test('作成・保存・取得・削除のリクエスト', async () => {
    const created = setup(() => json({ data: { id: 7, key: 'nabc' } }))
    expect(await created.client.createDraft()).toEqual({ id: 7, key: 'nabc' })
    expect(created.calls[0]?.init?.body).toBe('{"template_key":null}')

    const save = setup(() => json({ data: { result: true, updated_at: 't' } }, 201))
    await save.client.saveDraft(7, { name: 'T', body: '<p>x</p>', bodyLength: 1 })
    expect(save.calls[0]?.url).toBe(
      'https://note.com/api/v1/text_notes/draft_save?id=7&is_temp_saved=true',
    )
    expect(save.calls[0]?.init?.body).toBe('{"name":"T","body":"<p>x</p>","body_length":1}')

    const get = setup(() => json({ data: { name: 'T', body: 'B', status: 'draft' } }))
    expect((await get.client.getDraft('nabc')).status).toBe('draft')
    expect(get.calls[0]?.url).toBe(
      'https://note.com/api/v3/notes/nabc?draft=true&draft_reedit=false&ts=1700000000000',
    )

    const del = setup(() => new Response(null, { status: 200 }))
    await del.client.deleteDraft(7)
    expect(del.calls[0]?.init?.method).toBe('DELETE')
    expect(del.calls[0]?.url).toBe('https://note.com/api/v1/text_notes/draft_delete?id=7')
  })

  test('一覧は notes を読み、noteDraft.name をタイトルにする', async () => {
    const { calls, client } = setup(() =>
      json({
        data: {
          notes: [
            {
              id: 11,
              key: 'nAAA',
              status: 'draft',
              type: 'TextNote',
              name: null,
              noteDraft: { id: '999', name: 'タイトル', updatedAt: '2026-06-12T14:39:00.000Z' },
              displayDate: '2026/06/12 23:39',
              publishAt: null,
            },
            {
              id: 12,
              key: 'nBBB',
              status: 'draft',
              name: null,
              noteDraft: { id: '1000', name: '', updatedAt: '2026-06-13T00:00:00.000Z' },
            },
          ],
          magazines: [],
          categories: [],
          isLastPage: true,
          totalCount: 2,
          searchedUser: {},
        },
      }),
    )
    const page = await client.listDrafts(2)
    expect(calls[0]?.url).toBe(
      'https://note.com/api/v2/note_list/contents?kind=note&status=draft&page=2',
    )
    expect(page.isLastPage).toBe(true)
    expect(page.totalCount).toBe(2)
    expect(page.drafts).toEqual([
      {
        id: 11,
        key: 'nAAA',
        title: 'タイトル',
        updatedAt: '2026-06-12T14:39:00.000Z',
        status: 'draft',
      },
      { id: 12, key: 'nBBB', title: '', updatedAt: '2026-06-13T00:00:00.000Z', status: 'draft' },
    ])
  })

  test('一覧の形が想定外なら空にせずスキーマ不一致エラー', async () => {
    const odd = setup(() => json({ data: { contents: [{ id: 1, key: 'n1' }] } }))
    await expect(odd.client.listDrafts(1)).rejects.toThrow(/形式が想定と異なります/)
  })
})
