import { app, BrowserWindow, clipboard, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import {
  appDataSchema,
  groupSchema,
  repositoryActionSchema,
  type AppData,
  type DeviceLogin,
  type Group,
  type Repository,
} from '../../src/shared/types'

const clientId = process.env.GITHUB_CLIENT_ID ?? ''
const defaultData: AppData = { groups: [], assignments: {}, favorites: [] }
const safeName = z.string().trim().min(1).max(64)
const credentialSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number().nullable(),
  refreshToken: z.string().nullable(),
  refreshTokenExpiresAt: z.number().nullable(),
})
let windowRef: BrowserWindow | null = null
let deviceLogin: DeviceLogin | null = null
let github: Octokit | null = null
let githubToken: string | null = null
let credential: z.infer<typeof credentialSchema> | null = null
let credentialRefresh: Promise<z.infer<typeof credentialSchema>> | null = null

const tokenPath = () => join(app.getPath('userData'), 'github-token.bin')
const dataPath = () => join(app.getPath('userData'), 'organization.json')

async function loadData(): Promise<AppData> {
  try {
    const raw = await readFile(dataPath(), 'utf8')
    return appDataSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return defaultData
    throw new Error('Local organization data is invalid or unreadable.')
  }
}

async function saveData(data: AppData) {
  const parsed = appDataSchema.parse(data)
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(dataPath(), JSON.stringify(parsed, null, 2), 'utf8')
}

async function loadCredential() {
  if (credential) return credential
  if (!await safeStorage.isAsyncEncryptionAvailable()) return null
  try {
    const encrypted = await readFile(tokenPath())
    let decrypted = await safeStorage.decryptStringAsync(encrypted)
    if (decrypted.shouldReEncrypt) {
      const updated = await safeStorage.encryptStringAsync(decrypted.result)
      await writeFile(tokenPath(), updated)
      decrypted = await safeStorage.decryptStringAsync(updated)
    }
    const raw = decrypted.result
    credential = credentialSchema.parse(JSON.parse(raw))
    return credential
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw new Error('The saved GitHub credential could not be decrypted. Sign in again.')
  }
}

async function storeCredential(value: z.infer<typeof credentialSchema>) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this device.')
  }
  credential = credentialSchema.parse(value)
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(tokenPath(), await safeStorage.encryptStringAsync(JSON.stringify(credential)))
  if (process.platform !== 'win32') await chmod(tokenPath(), 0o600)
  github = new Octokit({ auth: credential.accessToken })
  githubToken = credential.accessToken
}

async function refreshCredential(current: z.infer<typeof credentialSchema>) {
  if (!current.refreshToken || (current.refreshTokenExpiresAt && current.refreshTokenExpiresAt <= Date.now())) {
    throw new Error('The GitHub session expired. Sign in again.')
  }
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
    }),
  })
  const result = z.object({
    access_token: z.string().optional(),
    expires_in: z.number().optional(),
    refresh_token: z.string().optional(),
    refresh_token_expires_in: z.number().optional(),
    error: z.string().optional(),
  }).parse(await response.json())
  if (!result.access_token) throw new Error('The GitHub session expired. Sign in again.')
  const next = {
    accessToken: result.access_token,
    expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : null,
    refreshToken: result.refresh_token ?? current.refreshToken,
    refreshTokenExpiresAt: result.refresh_token_expires_in
      ? Date.now() + result.refresh_token_expires_in * 1000
      : current.refreshTokenExpiresAt,
  }
  await storeCredential(next)
  return next
}

async function validCredential() {
  const current = await loadCredential()
  if (!current) throw new Error('Connect a GitHub account to continue.')
  if (!current.expiresAt || current.expiresAt > Date.now() + 60_000) return current
  if (!credentialRefresh) {
    credentialRefresh = refreshCredential(current).finally(() => { credentialRefresh = null })
  }
  return credentialRefresh
}

async function api() {
  const activeCredential = await validCredential()
  if (!github || githubToken !== activeCredential.accessToken) {
    github = new Octokit({ auth: activeCredential.accessToken })
    githubToken = activeCredential.accessToken
  }
  return github
}

function mapRepository(repo: Awaited<ReturnType<Octokit['repos']['get']>>['data']): Repository {
  const visibility: Repository['visibility'] = repo.visibility === 'internal'
    ? 'internal'
    : repo.private ? 'private' : 'public'
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description,
    htmlUrl: repo.html_url,
    cloneUrl: repo.clone_url,
    sshUrl: repo.ssh_url,
    visibility,
    language: repo.language,
    defaultBranch: repo.default_branch,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    archived: repo.archived,
    fork: repo.fork,
    topics: repo.topics ?? [],
    owner: repo.owner.login,
    homepage: repo.homepage,
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    const status = Number(error.status)
    if (status === 401) return 'GitHub rejected the saved session. Sign in again.'
    if (status === 403) return 'GitHub denied this operation. Check account permissions and API rate limits.'
    if (status === 404) return 'The repository was not found or is no longer accessible.'
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

function registerIpc() {
  ipcMain.handle('auth:status', async () => {
    try {
      const octokit = await api()
      const { data } = await octokit.users.getAuthenticated()
      return { connected: true, login: data.login, avatarUrl: data.avatar_url }
    } catch (error) {
      const message = errorMessage(error)
      if (message === 'Connect a GitHub account to continue.' || message.includes('Sign in again')) {
        github = null
        githubToken = null
        return { connected: false, login: null, avatarUrl: null }
      }
      throw new Error(message)
    }
  })

  ipcMain.handle('auth:begin', async () => {
    if (!clientId) throw new Error('Set GITHUB_CLIENT_ID in .env to enable GitHub sign-in.')
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: 'repo read:user offline_access' }),
    })
    const body: unknown = await response.json()
    const failure = z.object({ error: z.string(), error_description: z.string().optional() }).safeParse(body)
    if (failure.success) throw new Error(failure.data.error_description ?? `GitHub sign-in failed: ${failure.data.error}`)
    const result = z.object({
      device_code: z.string(),
      user_code: z.string(),
      verification_uri: z.string().url(),
      expires_in: z.number(),
      interval: z.number().optional(),
    }).parse(body)
    deviceLogin = { deviceCode: result.device_code, expiresAt: Date.now() + result.expires_in * 1000, interval: result.interval ?? 5 }
    return {
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      expiresIn: result.expires_in,
      interval: deviceLogin.interval,
    }
  })

  ipcMain.handle('auth:poll', async () => {
    if (!deviceLogin || Date.now() > deviceLogin.expiresAt) {
      deviceLogin = null
      return { status: 'expired' as const }
    }
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceLogin.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const result = z.object({
      access_token: z.string().optional(),
      expires_in: z.number().optional(),
      refresh_token: z.string().optional(),
      refresh_token_expires_in: z.number().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
      interval: z.number().optional(),
    }).parse(await response.json())
    if (result.access_token) {
      await storeCredential({
        accessToken: result.access_token,
        expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : null,
        refreshToken: result.refresh_token ?? null,
        refreshTokenExpiresAt: result.refresh_token_expires_in ? Date.now() + result.refresh_token_expires_in * 1000 : null,
      })
      deviceLogin = null
      return { status: 'authorized' as const }
    }
    if (result.error === 'authorization_pending') return { status: 'pending' as const, retryAfterMs: deviceLogin.interval * 1000 }
    if (result.error === 'slow_down') {
      deviceLogin.interval = Math.max(deviceLogin.interval + 5, result.interval ?? 0)
      return { status: 'pending' as const, retryAfterMs: deviceLogin.interval * 1000 }
    }
    if (result.error === 'expired_token' || result.error === 'token_expired' || result.error === 'access_denied') {
      deviceLogin = null
      return { status: 'expired' as const }
    }
    throw new Error(result.error_description ?? `GitHub sign-in failed: ${result.error ?? 'unknown response'}`)
  })

  ipcMain.handle('auth:sign-out', async () => {
    github = null
    githubToken = null
    credential = null
    credentialRefresh = null
    deviceLogin = null
    try {
      await unlink(tokenPath())
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  })

  ipcMain.handle('repos:list', async () => {
    try {
      const octokit = await api()
      const repositories = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        visibility: 'all',
        affiliation: 'owner,collaborator,organization_member',
        per_page: 100,
      })
      return repositories.map((repo) => mapRepository(repo as Awaited<ReturnType<Octokit['repos']['get']>>['data']))
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle('groups:load', () => loadData())
  ipcMain.handle('groups:save', async (_event, input: unknown) => saveData(appDataSchema.parse(input)))
  ipcMain.handle('auth:open', async (_event, input: unknown) => {
    const url = z.string().url().parse(input)
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !['github.com', 'docs.github.com'].includes(parsed.hostname) || (parsed.port && parsed.port !== '443')) {
      throw new Error('Only trusted GitHub HTTPS links can be opened.')
    }
    await shell.openExternal(parsed.toString())
  })
  ipcMain.handle('clipboard:write', (_event, input: unknown) => clipboard.writeText(z.string().max(512).parse(input)))

  ipcMain.handle('repo:action', async (_event, input: unknown) => {
    const action = repositoryActionSchema.parse(input)
    const octokit = await api()
    try {
      switch (action.type) {
        case 'visibility':
          await octokit.repos.update({ owner: action.owner, repo: action.repo, private: action.visibility === 'private' })
          break
        case 'archive':
          await octokit.repos.update({ owner: action.owner, repo: action.repo, archived: action.archived })
          break
        case 'edit':
          await octokit.repos.update({
            owner: action.owner, repo: action.repo, name: action.name,
            description: action.description, homepage: action.homepage,
          })
          break
        case 'topics':
          await octokit.repos.replaceAllTopics({ owner: action.owner, repo: action.repo, names: action.topics })
          break
      }
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  })

  ipcMain.handle('groups:create', async (_event, input: unknown) => {
    const parsed = z.object({ name: safeName, parentId: z.string().nullable() }).parse(input)
    const data = await loadData()
    if (parsed.parentId && !data.groups.some((group) => group.id === parsed.parentId)) {
      throw new Error('The parent group no longer exists.')
    }
    const group: Group = { id: crypto.randomUUID(), name: parsed.name, parentId: parsed.parentId }
    data.groups.push(groupSchema.parse(group))
    await saveData(data)
    return group
  })

  ipcMain.handle('groups:rename', async (_event, input: unknown) => {
    const parsed = z.object({ id: z.string(), name: safeName }).parse(input)
    const data = await loadData()
    const group = data.groups.find((item) => item.id === parsed.id)
    if (!group) throw new Error('That group no longer exists.')
    group.name = parsed.name
    await saveData(data)
    return data
  })

  ipcMain.handle('groups:delete', async (_event, input: unknown) => {
    const id = z.string().parse(input)
    const data = await loadData()
    const ids = new Set([id])
    let found = true
    while (found) {
      found = false
      for (const group of data.groups) {
        if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
          ids.add(group.id)
          found = true
        }
      }
    }
    data.groups = data.groups.filter((group) => !ids.has(group.id))
    for (const [repoId, assignments] of Object.entries(data.assignments)) {
      data.assignments[repoId] = assignments.filter((groupId) => !ids.has(groupId))
    }
    await saveData(data)
    return data
  })
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111318',
    title: 'Codexa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  windowRef.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.NODE_ENV === 'development'
      ? new URL(url).origin === 'http://localhost:5173'
      : url === pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
    if (!allowed) event.preventDefault()
  })

  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url)
    if (target.protocol === 'https:' && target.hostname === 'github.com' && (!target.port || target.port === '443')) {
      void shell.openExternal(target.toString())
    }
    return { action: 'deny' }
  })

  if (process.env.NODE_ENV === 'development') {
    void windowRef.loadURL('http://localhost:5173')
  } else {
    void windowRef.loadFile(join(__dirname, '../renderer/index.html'))
  }
  windowRef.on('closed', () => { windowRef = null })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
