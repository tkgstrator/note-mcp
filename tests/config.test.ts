import { describe, expect, test } from 'bun:test'
import { parseNetscapeCookie, resolveSession } from '../src/config'

// 明らかなダミー値のみ使う。
const cookies = [
  '# Netscape HTTP Cookie File',
  '.note.com\tTRUE\t/\tTRUE\t0\tother\tnope',
  '#HttpOnly_.note.com\tTRUE\t/\tTRUE\t0\t_note_session_v5\tDUMMY_FILE_VALUE',
].join('\n')

describe('resolveSession', () => {
  test('NOTE_SESSION を優先する', () => {
    const value = resolveSession(
      { NOTE_SESSION: ' DUMMY_ENV ', NOTE_COOKIE_FILE: '/x' },
      () => cookies,
    )
    expect(value).toBe('DUMMY_ENV')
  })

  test('NOTE_COOKIE_FILE から読む', () => {
    expect(resolveSession({ NOTE_COOKIE_FILE: '/x' }, () => cookies)).toBe('DUMMY_FILE_VALUE')
  })

  test('どちらも無ければ明確なエラー', () => {
    expect(() => resolveSession({})).toThrow(/NOTE_SESSION/)
  })

  test('ファイルが読めない/Cookie が無い場合のエラーに値を含めない', () => {
    expect(() =>
      resolveSession({ NOTE_COOKIE_FILE: '/x' }, () => {
        throw new Error('ENOENT')
      }),
    ).toThrow(/読み込めません/)
    expect(() => resolveSession({ NOTE_COOKIE_FILE: '/x' }, () => '# empty')).toThrow(
      /_note_session_v5 が見つかりません/,
    )
  })
})

describe('parseNetscapeCookie', () => {
  test('該当なしは undefined', () => {
    expect(parseNetscapeCookie(cookies, 'missing')).toBeUndefined()
  })
})
