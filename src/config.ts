import { readFileSync } from 'node:fs'

export const SESSION_COOKIE_NAME = '_note_session_v5'

export type ConfigEnv = Readonly<Record<string, string | undefined>>
export type ReadTextFile = (path: string) => string

/**
 * Netscape 形式 cookies.txt から指定 Cookie の値を取り出す。
 * 行: domain, includeSubdomains, path, secure, expires, name, value (タブ区切り)。
 * `#HttpOnly_` 接頭辞付きの行も有効な Cookie として扱う。
 */
export const parseNetscapeCookie = (text: string, name: string): string | undefined =>
  text
    .split(/\r?\n/)
    .map((line) => (line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line))
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 7 && cols[5] === name)
    .map((cols) => cols[6]?.trim())
    .find((value) => value !== undefined && value !== '')

/**
 * セッション Cookie の値を解決する。NOTE_SESSION を優先し、無ければ NOTE_COOKIE_FILE を読む。
 * エラーメッセージに Cookie の値は含めない。
 */
export const resolveSession = (
  env: ConfigEnv,
  readFile: ReadTextFile = (path) => readFileSync(path, 'utf8'),
): string => {
  const direct = env.NOTE_SESSION?.trim()
  if (direct) return direct

  const file = env.NOTE_COOKIE_FILE?.trim()
  if (file) {
    const text = (() => {
      try {
        return readFile(file)
      } catch {
        throw new Error(
          `NOTE_COOKIE_FILE (${file}) を読み込めませんでした。パスと権限を確認してください。`,
        )
      }
    })()
    const value = parseNetscapeCookie(text, SESSION_COOKIE_NAME)
    if (!value) {
      throw new Error(`NOTE_COOKIE_FILE (${file}) に ${SESSION_COOKIE_NAME} が見つかりません。`)
    }
    return value
  }

  throw new Error(
    `認証情報がありません。環境変数 NOTE_SESSION (${SESSION_COOKIE_NAME} の値) か、NOTE_COOKIE_FILE (Netscape 形式 cookies.txt のパス) を設定してください。`,
  )
}
