import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, DeviceLoginResponse, Repository, RepositoryAction } from '../../src/shared/types'

const api = {
  authStatus: () => ipcRenderer.invoke('auth:status') as Promise<{ connected: boolean; login: string | null; avatarUrl: string | null }>,
  beginLogin: () => ipcRenderer.invoke('auth:begin') as Promise<DeviceLoginResponse>,
  pollLogin: () => ipcRenderer.invoke('auth:poll') as Promise<{ status: 'pending' | 'authorized' | 'expired'; retryAfterMs?: number }>,
  signOut: () => ipcRenderer.invoke('auth:sign-out') as Promise<void>,
  listRepositories: () => ipcRenderer.invoke('repos:list') as Promise<Repository[]>,
  loadGroups: () => ipcRenderer.invoke('groups:load') as Promise<AppData>,
  saveGroups: (data: AppData) => ipcRenderer.invoke('groups:save', data) as Promise<void>,
  createGroup: (name: string, parentId: string | null) => ipcRenderer.invoke('groups:create', { name, parentId }),
  renameGroup: (id: string, name: string) => ipcRenderer.invoke('groups:rename', { id, name }) as Promise<AppData>,
  deleteGroup: (id: string) => ipcRenderer.invoke('groups:delete', id) as Promise<AppData>,
  repositoryAction: (action: RepositoryAction) => ipcRenderer.invoke('repo:action', action) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('auth:open', url) as Promise<void>,
  copyText: (value: string) => ipcRenderer.invoke('clipboard:write', value) as Promise<void>,
}

contextBridge.exposeInMainWorld('codexa', api)
