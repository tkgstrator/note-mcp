import { z } from 'zod'

export const API_BASE = 'https://note.com/api'
export const EDITOR_ORIGIN = 'https://editor.note.com'
export const editUrl = (key: string): string => `${EDITOR_ORIGIN}/notes/${key}/edit/`

export class NoteApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'NoteApiError'
    this.status = status
  }
}

// レスポンスは必要な項目だけを検証し、余分な項目は許容する。
const created = z.object({ data: z.looseObject({ id: z.number(), key: z.string() }) })
const saved = z.object({
  data: z.looseObject({ result: z.boolean(), updated_at: z.string().optional() }),
})
const draft = z.object({
  data: z.looseObject({
    id: z.coerce.number().optional(),
    key: z.string().optional(),
    name: z.string().nullish(),
    body: z.string().nullish(),
    status: z.string().nullish(),
  }),
})
const currentUser = z.object({
  data: z.looseObject({ urlname: z.string(), nickname: z.string().nullish(), id: z.number() }),
})
// 一覧 API (実機確認済み)。想定外の形は黙って空にせずスキーマ不一致エラーにする。
// 下書きでは要素直下の name は常に null で、タイトルは noteDraft.name に入る。
// 要素直下の id (数値) が note_delete_draft に渡す id。noteDraft.id は別物の文字列。
const draftListItem = z.looseObject({
  id: z.number(),
  key: z.string(),
  status: z.string(),
  noteDraft: z.looseObject({ name: z.string(), updatedAt: z.string() }),
})
const draftList = z.object({
  data: z.looseObject({
    notes: z.array(draftListItem),
    isLastPage: z.boolean(),
    totalCount: z.number(),
  }),
})

export type CurrentUser = z.infer<typeof currentUser>['data']
export type Draft = z.infer<typeof draft>['data']
export type DraftListItem = {
  id: number
  key: string
  title: string
  updatedAt: string
  status: string
}
export type DraftListPage = { drafts: DraftListItem[]; isLastPage: boolean; totalCount: number }

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
export type NoteClient = ReturnType<typeof createNoteClient>

const EXPIRED = 'Cookieが期限切れ/無効です。NOTE_SESSIONを更新してください。'

const pathOnly = (path: string): string => path.split('?')[0] ?? path

export const createNoteClient = (options: {
  session: string
  fetch?: FetchLike
  now?: () => number
}) => {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? Date.now

  const headers = (): Record<string, string> => ({
    Cookie: `_note_session_v5=${options.session}`,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: EDITOR_ORIGIN,
    Referer: `${EDITOR_ORIGIN}/`,
    'User-Agent': 'Mozilla/5.0 (compatible; note-mcp/0.1)',
  })

  const send = async (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => {
    const response = await doFetch(`${API_BASE}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if ([401, 403, 422].includes(response.status)) {
      throw new NoteApiError(`${EXPIRED} (HTTP ${response.status})`, response.status)
    }
    if (!response.ok) {
      throw new NoteApiError(
        `note API エラー: ${method} ${pathOnly(path)} (HTTP ${response.status})`,
        response.status,
      )
    }
    return response
  }

  const requestJson = async <T extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.infer<T>> => {
    const response = await send(method, path, body)
    const json: unknown = await response.json().catch(() => undefined)
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      throw new NoteApiError(
        `note API のレスポンス形式が想定と異なります: ${pathOnly(path)}`,
        response.status,
      )
    }
    return parsed.data
  }

  return {
    whoami: async (): Promise<CurrentUser> =>
      (await requestJson('GET', '/v2/current_user', currentUser)).data,

    createDraft: async (): Promise<{ id: number; key: string }> => {
      const { data } = await requestJson('POST', '/v1/text_notes', created, { template_key: null })
      return { id: data.id, key: data.key }
    },

    saveDraft: async (
      id: number,
      input: { name: string; body: string; bodyLength: number },
    ): Promise<{ updatedAt?: string }> => {
      const { data } = await requestJson(
        'POST',
        `/v1/text_notes/draft_save?id=${id}&is_temp_saved=true`,
        saved,
        { name: input.name, body: input.body, body_length: input.bodyLength },
      )
      if (!data.result) throw new NoteApiError('下書きの保存に失敗しました。', 200)
      return { updatedAt: data.updated_at }
    },

    getDraft: async (key: string): Promise<Draft> =>
      (
        await requestJson(
          'GET',
          `/v3/notes/${encodeURIComponent(key)}?draft=true&draft_reedit=false&ts=${now()}`,
          draft,
        )
      ).data,

    listDrafts: async (page: number): Promise<DraftListPage> => {
      const { data } = await requestJson(
        'GET',
        `/v2/note_list/contents?kind=note&status=draft&page=${page}`,
        draftList,
      )
      return {
        drafts: data.notes.map((n) => ({
          id: n.id,
          key: n.key,
          title: n.noteDraft.name,
          updatedAt: n.noteDraft.updatedAt,
          status: n.status,
        })),
        isLastPage: data.isLastPage,
        totalCount: data.totalCount,
      }
    },

    deleteDraft: async (id: number): Promise<void> => {
      await send('DELETE', `/v1/text_notes/draft_delete?id=${id}`)
    },
  }
}
