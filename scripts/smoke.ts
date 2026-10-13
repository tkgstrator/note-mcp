import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const argumentsList = process.argv.slice(2).filter((argument) => argument !== '--')
const docker = argumentsList[0] === '--docker'
const binary = argumentsList[0] === '--binary'
if (argumentsList.length > (docker ? 2 : 1) || (argumentsList[0] && !docker && !binary)) {
  throw new Error('Usage: bun run smoke [--binary | --docker IMAGE]')
}
const name = `note-mcp-smoke-${randomUUID()}`
const dummy = 'dummy-smoke-session'
const transport = new StdioClientTransport({
  command: docker ? 'docker' : binary ? './dist/note-mcp' : 'bun',
  args: docker
    ? [
        'run',
        '-i',
        '--rm',
        '--name',
        name,
        '--network',
        'none',
        '-e',
        `NOTE_SESSION=${dummy}`,
        argumentsList[1] ?? 'note-mcp:local',
      ]
    : binary
      ? []
      : ['src/index.ts'],
  env: { PATH: process.env.PATH ?? '', NOTE_SESSION: dummy },
  stderr: 'inherit',
})
const client = new Client({ name: 'note-mcp-smoke', version: '0.1.0' })
const expected = [
  'note_whoami',
  'note_create_draft',
  'note_update_draft',
  'note_get_draft',
  'note_list_drafts',
  'note_delete_draft',
].sort()
const stop = Promise.withResolvers<never>()
const timer = setTimeout(() => stop.reject(new Error('MCP smoke test timed out (30s)')), 30_000)
const interrupted = () => stop.reject(new Error('MCP smoke test interrupted'))
process.once('SIGINT', interrupted)
process.once('SIGTERM', interrupted)

try {
  await Promise.race([
    (async () => {
      await client.connect(transport)
      const result = await client.listTools()
      const names = result.tools.map((tool) => tool.name).sort()
      if (JSON.stringify(names) !== JSON.stringify(expected)) {
        throw new Error(`Unexpected tools: ${names.join(', ')}`)
      }
      console.log(`MCP initialize/listTools OK: ${names.length} tools`)
    })(),
    stop.promise,
  ])
} finally {
  clearTimeout(timer)
  process.removeListener('SIGINT', interrupted)
  process.removeListener('SIGTERM', interrupted)
  try {
    await client.close()
  } finally {
    await transport.close()
    if (docker) {
      const inspect = spawnSync('docker', ['inspect', name], { timeout: 5_000, encoding: 'utf8' })
      if (inspect.status === 0) {
        const removed = spawnSync('docker', ['rm', '-f', name], {
          timeout: 5_000,
          encoding: 'utf8',
        })
        if (removed.status !== 0) throw new Error('Owned smoke container cleanup failed')
      } else if (!/no such (object|container)/i.test(inspect.stderr)) {
        throw new Error('Could not verify owned smoke container cleanup')
      }
    }
  }
}
