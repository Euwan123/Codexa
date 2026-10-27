import { z } from 'zod'

export type Repository = {
  id: number
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  cloneUrl: string
  sshUrl: string
  visibility: 'public' | 'private' | 'internal'
  language: string | null
  defaultBranch: string
  stars: number
  forks: number
  createdAt: string
  updatedAt: string
  archived: boolean
  fork: boolean
  topics: string[]
  owner: string
  homepage: string | null
}

export type Group = { id: string; name: string; parentId: string | null }
export type AppData = { groups: Group[]; assignments: Record<string, string[]>; favorites: number[] }
export type DeviceLogin = { deviceCode: string; expiresAt: number; interval: number }
export type DeviceLoginResponse = { userCode: string; verificationUri: string; expiresIn: number; interval: number }

export type RepositoryAction =
  | { type: 'visibility'; owner: string; repo: string; visibility: 'public' | 'private' }
  | { type: 'archive'; owner: string; repo: string; archived: boolean }
  | { type: 'edit'; owner: string; repo: string; name: string; description: string; homepage: string }
  | { type: 'topics'; owner: string; repo: string; topics: string[] }

const id = z.string().min(1).max(64)
const ownerName = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/)
const repositoryName = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/)
const topicName = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,49}$/)
export const groupSchema = z.object({ id, name: z.string().trim().min(1).max(64), parentId: id.nullable() })
export const appDataSchema = z.object({
  groups: z.array(groupSchema).max(500),
  assignments: z.record(z.string(), z.array(id).max(100)),
  favorites: z.array(z.number().int().positive()).max(10000),
}).superRefine((data, context) => {
  const groupIds = new Set(data.groups.map((group) => group.id))
  if (groupIds.size !== data.groups.length) {
    context.addIssue({ code: 'custom', message: 'Group identifiers must be unique.' })
  }
  for (const group of data.groups) {
    if (group.parentId && !groupIds.has(group.parentId)) {
      context.addIssue({ code: 'custom', message: 'A group references a missing parent.' })
    }
    if (group.parentId === group.id) {
      context.addIssue({ code: 'custom', message: 'A group cannot contain itself.' })
    }
  }
  for (const assignments of Object.values(data.assignments)) {
    if (assignments.some((groupId) => !groupIds.has(groupId))) {
      context.addIssue({ code: 'custom', message: 'A repository references a missing group.' })
    }
  }
  for (const group of data.groups) {
    const visited = new Set<string>()
    let parentId = group.parentId
    while (parentId) {
      if (visited.has(parentId) || parentId === group.id) {
        context.addIssue({ code: 'custom', message: 'Group nesting cannot contain a cycle.' })
        break
      }
      visited.add(parentId)
      parentId = data.groups.find((candidate) => candidate.id === parentId)?.parentId ?? null
    }
  }
})

export const repositoryActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visibility'), owner: ownerName, repo: repositoryName, visibility: z.enum(['public', 'private']) }),
  z.object({ type: z.literal('archive'), owner: ownerName, repo: repositoryName, archived: z.boolean() }),
  z.object({ type: z.literal('edit'), owner: ownerName, repo: repositoryName, name: repositoryName, description: z.string().max(350), homepage: z.string().max(256) }),
  z.object({ type: z.literal('topics'), owner: ownerName, repo: repositoryName, topics: z.array(topicName).max(20) }),
])

declare global {
  interface Window {
    codexa: {
      authStatus: () => Promise<{ connected: boolean; login: string | null; avatarUrl: string | null }>
      beginLogin: () => Promise<DeviceLoginResponse>
      pollLogin: () => Promise<{ status: 'pending' | 'authorized' | 'expired'; retryAfterMs?: number }>
      signOut: () => Promise<void>
      listRepositories: () => Promise<Repository[]>
      loadGroups: () => Promise<AppData>
      saveGroups: (data: AppData) => Promise<void>
      createGroup: (name: string, parentId: string | null) => Promise<Group>
      renameGroup: (id: string, name: string) => Promise<AppData>
      deleteGroup: (id: string) => Promise<AppData>
      repositoryAction: (action: RepositoryAction) => Promise<void>
      openExternal: (url: string) => Promise<void>
      copyText: (value: string) => Promise<void>
    }
  }
}
