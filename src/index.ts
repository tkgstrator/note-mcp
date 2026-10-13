import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createNoteClient } from './client.ts'
import { resolveSession } from './config.ts'
import { registerTools } from './tools.ts'

const main = async (): Promise<void> => {
  const session = resolveSession(process.env)
  const server = new McpServer({ name: 'note-mcp', version: '0.1.0' })
  registerTools(server, createNoteClient({ session }))
  await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
  // stdout は MCP プロトコル専用。診断は stderr へ。Cookie の値は含まれない。
  console.error(`note-mcp: ${error instanceof Error ? error.message : '起動に失敗しました。'}`)
  process.exit(1)
})
