import { loadEnv } from 'vite'

const { GITHUB_CLIENT_ID: clientId } = loadEnv('production', process.cwd(), '')
if (!clientId?.trim()) {
  console.error('Set GITHUB_CLIENT_ID in .env before packaging the Windows app.')
  process.exitCode = 1
}
