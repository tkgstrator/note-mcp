import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { editUrl, NoteApiError, type NoteClient } from './client.ts'
import { htmlTextLength, markdownToNoteBody } from './markdown.ts'

export const toolInputs = {
  note_whoami: {},
  note_create_draft: {
    title: z.string().min(1).describe('記事タイトル'),
    markdown: z.string().describe('本文 (Markdown)'),
  },
  note_update_draft: {
    key: z.string().min(1).optional().describe('下書きの key (n...)'),
    id: z.number().int().positive().optional().describe('下書きの数値 id'),
    title: z.string().min(1).optional().describe('新しいタイトル'),
    markdown: z.string().optional().describe('新しい本文 (Markdown)'),
  },
  note_get_draft: { key: z.string().min(1).describe('下書きの key (n...)') },
  note_list_drafts: {
    page: z.number().int().positive().default(1).describe('ページ番号'),
  },
  note_delete_draft: { id: z.number().int().positive().describe('下書きの数値 id') },
} as const

type Inputs = {
  [K in keyof typeof toolInputs]: z.infer<z.ZodObject<(typeof toolInputs)[K]>>
}

export type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

const guard = async (run: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await run()
  } catch (error) {
    // Cookie の値は NoteApiError のメッセージに含まれない。
    return fail(error instanceof NoteApiError ? error.message : '予期しないエラーが発生しました。')
  }
}

export const createHandlers = (client: NoteClient) => ({
  note_whoami: (): Promise<ToolResult> =>
    guard(async () => {
      const user = await client.whoami()
      return ok({ id: user.id, urlname: user.urlname, nickname: user.nickname ?? null })
    }),

  note_create_draft: (input: Inputs['note_create_draft']): Promise<ToolResult> =>
    guard(async () => {
      const body = markdownToNoteBody(input.markdown)
      const { id, key } = await client.createDraft()
      const { updatedAt } = await client.saveDraft(id, {
        name: input.title,
        body: body.html,
        bodyLength: body.bodyLength,
      })
      return ok({ id, key, editUrl: editUrl(key), updatedAt: updatedAt ?? null })
    }),

  note_update_draft: (input: Inputs['note_update_draft']): Promise<ToolResult> =>
    guard(async () => {
      if (input.key === undefined && input.id === undefined) {
        return fail('key か id のどちらかを指定してください。')
      }
      if (input.title === undefined && input.markdown === undefined) {
        return fail('title か markdown の少なくとも一方を指定してください。')
      }
      // key があれば現在の内容を読んで、未指定の項目を引き継ぐ。
      const current = input.key === undefined ? undefined : await client.getDraft(input.key)
      if (input.key !== undefined && input.id !== undefined && current?.id !== input.id) {
        return fail('key と id が同じ下書きであることを確認できません。保存せず終了しました。')
      }
      const id = input.id ?? current?.id
      if (id === undefined) {
        return fail('下書きの id を特定できません。id を指定してください。')
      }
      const title = input.title ?? current?.name ?? undefined
      if (title === undefined) {
        return fail('id のみで更新する場合は title も指定してください。')
      }
      const next = (() => {
        if (input.markdown !== undefined) {
          const converted = markdownToNoteBody(input.markdown)
          return { html: converted.html, bodyLength: converted.bodyLength }
        }
        const html = current?.body ?? undefined
        return html === undefined ? undefined : { html, bodyLength: htmlTextLength(html) }
      })()
      if (next === undefined) {
        return fail('id のみで更新する場合は markdown も指定してください。')
      }
      const { updatedAt } = await client.saveDraft(id, {
        name: title,
        body: next.html,
        bodyLength: next.bodyLength,
      })
      const key = input.key ?? current?.key
      return ok({
        id,
        key: key ?? null,
        editUrl: key ? editUrl(key) : null,
        updatedAt: updatedAt ?? null,
      })
    }),

  note_get_draft: (input: Inputs['note_get_draft']): Promise<ToolResult> =>
    guard(async () => {
      const draft = await client.getDraft(input.key)
      return ok({
        id: draft.id ?? null,
        key: draft.key ?? input.key,
        title: draft.name ?? null,
        status: draft.status ?? null,
        bodyHtml: draft.body ?? null,
        editUrl: editUrl(input.key),
      })
    }),

  note_list_drafts: (input: Inputs['note_list_drafts']): Promise<ToolResult> =>
    guard(async () => {
      const result = await client.listDrafts(input.page)
      return ok({
        page: input.page,
        isLastPage: result.isLastPage,
        totalCount: result.totalCount,
        drafts: result.drafts.map((d) => ({ ...d, editUrl: editUrl(d.key) })),
      })
    }),

  note_delete_draft: (input: Inputs['note_delete_draft']): Promise<ToolResult> =>
    guard(async () => {
      await client.deleteDraft(input.id)
      return ok({ deleted: true, id: input.id })
    }),
})

export const registerTools = (server: McpServer, client: NoteClient): void => {
  const h = createHandlers(client)

  server.registerTool(
    'note_whoami',
    {
      title: 'note ユーザー確認',
      description: 'Cookie を検証し、ログイン中の note ユーザーを返す。',
      inputSchema: toolInputs.note_whoami,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => h.note_whoami(),
  )
  server.registerTool(
    'note_create_draft',
    {
      title: '下書き作成',
      description:
        'Markdown から note の下書きを新規作成して保存し、id / key / 編集 URL を返す。公開はしない。',
      inputSchema: toolInputs.note_create_draft,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (input) => h.note_create_draft(input),
  )
  server.registerTool(
    'note_update_draft',
    {
      title: '下書き更新',
      description:
        'key または id で下書きを更新する。title / markdown の指定した方だけ置き換える（本文は上書きされる）。key 指定なら未指定項目は現在の内容を引き継ぐ。',
      inputSchema: toolInputs.note_update_draft,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) => h.note_update_draft(input),
  )
  server.registerTool(
    'note_get_draft',
    {
      title: '下書き取得',
      description: 'key で下書きのタイトルと本文 HTML を取得する。',
      inputSchema: toolInputs.note_get_draft,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) => h.note_get_draft(input),
  )
  server.registerTool(
    'note_list_drafts',
    {
      title: '下書き一覧',
      description:
        '自分の下書き一覧を取得する (GET /v2/note_list/contents?kind=note&status=draft)。title は noteDraft.name (空文字の場合あり)。id は note_delete_draft に渡せる数値 id。page で続きを取得し、isLastPage で終端を判断する。',
      inputSchema: toolInputs.note_list_drafts,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) => h.note_list_drafts(input),
  )
  server.registerTool(
    'note_delete_draft',
    {
      title: '下書き削除',
      description: '下書きを id で削除する。元に戻せない。',
      inputSchema: toolInputs.note_delete_draft,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) => h.note_delete_draft(input),
  )
}
