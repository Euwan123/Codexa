import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  Archive, ArrowDownUp, ArrowRight, Check, ChevronDown, ChevronRight,
  CircleHelp, Command, Copy, ExternalLink, Eye, Folder, FolderPlus, GitBranch, Grid2X2,
  Heart, LayoutList, LockKeyhole, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
  Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Star, Sun,
  Tag, X,
} from 'lucide-react'
import { assignToGroup, getGroupDescendantIds, getRepositoryIdsForGroup } from './shared/groups'
import type { AppData, Group, Repository } from './shared/types'
import './App.css'

type AuthState = { connected: boolean; login: string | null; avatarUrl: string | null }
type Filter = 'all' | 'public' | 'private' | 'archived' | 'forks' | 'recent' | 'favorites'
type SortKey = 'name' | 'language' | 'updatedAt' | 'visibility' | 'createdAt'
type BulkDialog = 'move' | 'archive' | 'unarchive' | 'public' | 'private' | null

const emptyData: AppData = { groups: [], assignments: {}, favorites: [] }
const formatDate = (date: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))
const mountedAt = Date.now()

function App() {
  const [auth, setAuth] = useState<AuthState>({ connected: false, login: null, avatarUrl: null })
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [data, setData] = useState<AppData>(emptyData)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [gridView, setGridView] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [detailId, setDetailId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingRepos, setLoadingRepos] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [lightTheme, setLightTheme] = useState(false)
  const [loginCode, setLoginCode] = useState<{ code: string; uri: string; expiresIn: number } | null>(null)
  const [groupDialog, setGroupDialog] = useState<{ mode: 'create' | 'rename'; id?: string } | null>(null)
  const [groupName, setGroupName] = useState('')
  const [repoDialog, setRepoDialog] = useState<'edit' | 'topics' | null>(null)
  const [repoForm, setRepoForm] = useState({ name: '', description: '', homepage: '', topics: '' })
  const [bulkDialog, setBulkDialog] = useState<BulkDialog>(null)
  const [filterPanel, setFilterPanel] = useState(false)
  const anchor = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const loginRun = useRef(false)

  const refreshRepositories = useCallback(async () => {
    setLoadingRepos(true)
    setError('')
    setSyncError('')
    try {
      setRepositories(await window.codexa.listRepositories())
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Repositories could not be loaded.'
      setError(message)
      setSyncError(message)
    } finally {
      setLoadingRepos(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      const [authResult, dataResult] = await Promise.allSettled([
        window.codexa.authStatus(),
        window.codexa.loadGroups(),
      ])
      if (!active) return
      if (authResult.status === 'fulfilled') setAuth(authResult.value)
      if (dataResult.status === 'fulfilled') setData(dataResult.value)
      const errors = [authResult, dataResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : 'Initial data could not be loaded.')
      if (errors.length) {
        window.setTimeout(() => {
          if (active) setError(errors.join(' '))
        }, 0)
      }
    }
    void initialize()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!auth.connected) return
    let active = true
    void window.codexa.listRepositories()
      .then((items) => {
        if (active) {
          setRepositories(items)
          setSyncError('')
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          const message = reason instanceof Error ? reason.message : 'Repositories could not be loaded.'
          setError(message)
          setSyncError(message)
        }
      })
      .finally(() => { if (active) setLoadingRepos(false) })
    return () => { active = false }
  }, [auth.connected])

  useEffect(() => {
    document.documentElement.dataset.theme = lightTheme ? 'light' : 'dark'
  }, [lightTheme])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])

  const currentGroup = data.groups.find((group) => group.id === activeGroup)
  const activeRepo = repositories.find((repo) => repo.id === detailId) ?? null
  const allAssignedIds = useMemo(() => new Set(Object.keys(data.assignments).map(Number)), [data.assignments])
  const visibleRepos = useMemo(() => {
    let result = [...repositories]
    if (activeGroup === '__uncategorized__') {
      result = result.filter((repo) => !allAssignedIds.has(repo.id) || !data.assignments[String(repo.id)]?.length)
    } else if (activeGroup) {
      const ids = new Set(getRepositoryIdsForGroup(data, activeGroup))
      result = result.filter((repo) => ids.has(repo.id))
    }
    if (filter === 'public') result = result.filter((repo) => repo.visibility === 'public')
    if (filter === 'private') result = result.filter((repo) => repo.visibility === 'private')
    if (filter === 'archived') result = result.filter((repo) => repo.archived)
    if (filter === 'forks') result = result.filter((repo) => repo.fork)
    if (filter === 'favorites') result = result.filter((repo) => data.favorites.includes(repo.id))
    if (filter === 'recent') result = result.filter((repo) => mountedAt - new Date(repo.updatedAt).getTime() < 30 * 86400000)
    const query = search.trim().toLowerCase()
    if (query) result = result.filter((repo) => `${repo.name} ${repo.owner} ${repo.description ?? ''} ${repo.language ?? ''} ${repo.topics.join(' ')}`.toLowerCase().includes(query))
    return result.sort((a, b) => {
      const first = a[sortKey] ?? ''
      const second = b[sortKey] ?? ''
      if (sortKey === 'updatedAt' || sortKey === 'createdAt') return String(second).localeCompare(String(first))
      if (typeof first === 'number' && typeof second === 'number') return second - first
      return String(first).localeCompare(String(second), undefined, { sensitivity: 'base' })
    })
  }, [repositories, activeGroup, filter, allAssignedIds, data, search, sortKey])

  const childGroups = useMemo(() => data.groups.filter((group) => group.parentId === null), [data.groups])
  const countForGroup = (group: Group) => getRepositoryIdsForGroup(data, group.id).length

  const updateData = async (next: AppData): Promise<boolean> => {
    setData(next)
    try {
      await window.codexa.saveGroups(next)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your organization changes could not be saved.')
      setData(await window.codexa.loadGroups())
      return false
    }
  }

  const startLogin = async () => {
    setBusy(true)
    setError('')
    try {
      loginRun.current = true
      const login = await window.codexa.beginLogin()
      setLoginCode({ code: login.userCode, uri: login.verificationUri, expiresIn: login.expiresIn })
      await window.codexa.openExternal(login.verificationUri)
      const poll = async (delay: number): Promise<void> => {
        if (!loginRun.current) return
        await new Promise((resolve) => window.setTimeout(resolve, delay))
        const result = await window.codexa.pollLogin()
        if (result.status === 'authorized') {
          loginRun.current = false
          setLoginCode(null)
          const nextAuth = await window.codexa.authStatus()
          setLoadingRepos(true)
          setAuth(nextAuth)
          setNotice('GitHub connected securely')
          return
        }
        if (result.status === 'expired') {
          loginRun.current = false
          setLoginCode(null)
          setError('That sign-in code expired. Start again to get a new one.')
          return
        }
        await poll(result.retryAfterMs ?? 5000)
      }
      void poll(login.interval * 1000).catch((reason: unknown) => {
        loginRun.current = false
        setLoginCode(null)
        setError(reason instanceof Error ? reason.message : 'GitHub sign-in failed.')
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GitHub sign-in could not be started.')
    } finally {
      setBusy(false)
    }
  }

  const createGroup = async () => {
    const name = groupName.trim()
    if (!name) return
    setBusy(true)
    try {
      if (groupDialog?.mode === 'rename' && groupDialog.id) {
        setData(await window.codexa.renameGroup(groupDialog.id, name))
      } else {
        const group = await window.codexa.createGroup(name, activeGroup === '__uncategorized__' ? null : activeGroup)
        setData(await window.codexa.loadGroups())
        setActiveGroup(group.id)
      }
      setGroupDialog(null)
      setGroupName('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Group could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const deleteGroup = async (group: Group) => {
    if (!window.confirm(`Delete “${group.name}” and its nested groups? Repositories will remain on GitHub.`)) return
    try {
      setData(await window.codexa.deleteGroup(group.id))
      if (activeGroup && getGroupDescendantIds(data.groups, group.id).has(activeGroup)) setActiveGroup(null)
      setNotice('Virtual group removed')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Group could not be deleted.')
    }
  }

  const moveSelected = async (groupId: string | null) => {
    const next = assignToGroup(data, selected, groupId)
    if (!await updateData(next)) return
    setNotice(groupId ? `Moved ${selected.length} ${selected.length === 1 ? 'repository' : 'repositories'}` : 'Removed from group')
    setSelected([])
    setBulkDialog(null)
  }

  const toggleFavorite = (repoId: number) => {
    const favorites = data.favorites.includes(repoId)
      ? data.favorites.filter((id) => id !== repoId)
      : [...data.favorites, repoId]
    void updateData({ ...data, favorites })
  }

  const selectRepository = (event: MouseEvent, id: number, index: number) => {
    if (event.shiftKey && anchor.current !== null) {
      const from = visibleRepos.findIndex((repo) => repo.id === anchor.current)
      const range = visibleRepos.slice(Math.min(from, index), Math.max(from, index) + 1).map((repo) => repo.id)
      setSelected(range)
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
      anchor.current = id
    } else {
      setSelected([id])
      anchor.current = id
    }
    setDetailId(id)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault()
        setSelected(visibleRepos.map((repo) => repo.id))
      }
      if (event.key === 'Escape') setSelected([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleRepos])

  const applyRepoAction = async (action: Parameters<typeof window.codexa.repositoryAction>[0]) => {
    setBusy(true)
    setError('')
    try {
      await window.codexa.repositoryAction(action)
      await refreshRepositories()
      setNotice('GitHub repository updated')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GitHub could not complete that action.')
    } finally {
      setBusy(false)
    }
  }

  const openRepoDialog = (mode: 'edit' | 'topics', repo: Repository) => {
    setRepoForm({
      name: repo.name,
      description: repo.description ?? '',
      homepage: repo.homepage ?? '',
      topics: repo.topics.join(', '),
    })
    setRepoDialog(mode)
  }

  const saveRepoDialog = async () => {
    if (!activeRepo || !repoDialog) return
    if (repoDialog === 'edit') {
      await applyRepoAction({
        type: 'edit', owner: activeRepo.owner, repo: activeRepo.name,
        name: repoForm.name.trim(), description: repoForm.description.trim(), homepage: repoForm.homepage.trim(),
      })
    } else {
      await applyRepoAction({
        type: 'topics', owner: activeRepo.owner, repo: activeRepo.name,
        topics: repoForm.topics.split(',').map((topic) => topic.trim().toLowerCase()).filter(Boolean),
      })
    }
    setRepoDialog(null)
  }

  const bulkArchive = async (archived: boolean) => {
    const repos = repositories.filter((repo) => selected.includes(repo.id) && repo.archived !== archived)
    setBusy(true)
    let successes = 0
    const failures: string[] = []
    for (const repo of repos) {
      try {
        await window.codexa.repositoryAction({ type: 'archive', owner: repo.owner, repo: repo.name, archived })
        successes += 1
      } catch (reason) {
        failures.push(`${repo.fullName}: ${reason instanceof Error ? reason.message : 'failed'}`)
      }
    }
    setBusy(false)
    await refreshRepositories()
    setSelected([])
    setBulkDialog(null)
    if (failures.length) setError(`${successes} completed; ${failures.length} failed. ${failures.slice(0, 3).join(' | ')}`)
    else setNotice(successes ? `${successes} repositories ${archived ? 'archived' : 'unarchived'}` : 'No repository changes were needed')
  }

  const bulkVisibility = async (visibility: 'public' | 'private') => {
    const repos = repositories.filter((repo) => selected.includes(repo.id) && repo.visibility !== visibility)
    setBusy(true)
    let successes = 0
    const failures: string[] = []
    for (const repo of repos) {
      try {
        await window.codexa.repositoryAction({ type: 'visibility', owner: repo.owner, repo: repo.name, visibility })
        successes += 1
      } catch (reason) {
        failures.push(`${repo.fullName}: ${reason instanceof Error ? reason.message : 'failed'}`)
      }
    }
    setBusy(false)
    await refreshRepositories()
    setSelected([])
    setBulkDialog(null)
    if (failures.length) setError(`${successes} completed; ${failures.length} failed. ${failures.slice(0, 3).join(' | ')}`)
    else setNotice(successes ? `${successes} repositories made ${visibility}` : 'No repository changes were needed')
  }

  const exportOrganization = () => {
    const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = 'codexa-organization.json'
    link.click()
    URL.revokeObjectURL(link.href)
    setNotice('Organization backup exported')
  }

  const exportSelectedRepositories = () => {
    const selectedRepos = repositories.filter((repo) => selected.includes(repo.id))
    const file = new Blob([JSON.stringify(selectedRepos, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = 'codexa-selected-repositories.json'
    link.click()
    URL.revokeObjectURL(link.href)
    setNotice(`${selectedRepos.length} repositories exported`)
  }

  const importOrganization = async (file?: File) => {
    if (!file) return
    try {
      const imported = JSON.parse(await file.text()) as AppData
      if (await updateData(imported)) setNotice('Organization backup restored')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That backup file is invalid.')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  if (!auth.connected) {
    return (
      <main className="welcome-screen">
        <div className="welcome-card">
          <div className="brand-lockup"><span className="brand-mark"><GitBranch size={21} /></span><span>codexa</span></div>
          <div className="welcome-art" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="folder-illustration"><Folder size={70} strokeWidth={1.2} /><span><GitBranch size={25} /></span></div>
          </div>
          <p className="eyebrow">YOUR REPOSITORIES, REIMAGINED</p>
          <h1>A calmer way to<br /><span>work with GitHub.</span></h1>
          <p className="welcome-copy">Bring every repository into one focused workspace. Make virtual folders, keep your real GitHub structure untouched.</p>
          {error && <div className="inline-error"><CircleHelp size={15} />{error}</div>}
          {loginCode ? (
            <div className="device-code">
              <span className="eyebrow">ENTER THIS CODE ON GITHUB</span>
              <strong>{loginCode.code}</strong>
              <span>Waiting for authorization… The code expires in {Math.ceil(loginCode.expiresIn / 60)} minutes.</span>
              <button className="text-button" onClick={() => { loginRun.current = false; setLoginCode(null) }}>Cancel sign-in</button>
            </div>
          ) : (
            <button className="primary-button connect-button" onClick={() => void startLogin()} disabled={busy}>
              <GitBranch size={17} /> {busy ? 'Starting secure sign-in…' : 'Connect GitHub'}
              <ArrowRight size={16} />
            </button>
          )}
          <div className="trust-note"><ShieldCheck size={15} /><span>Protected by GitHub Device Flow and Windows secure storage</span></div>
          <div className="welcome-foot"><span>Private by design</span><span>·</span><span>No demo data</span><span>·</span><span>Your organization stays local</span></div>
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand"><span className="brand-mark"><GitBranch size={17} /></span><span>codexa</span><span className="brand-divider" /><span className="workspace-label">Workspace</span></div>
        <div className="topbar-center"><div className="global-search"><Search size={16} /><input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search repositories..." /><kbd>⌘ K</kbd></div></div>
        <div className="topbar-actions">
          <button className="icon-button" title="Refresh repositories" onClick={() => void refreshRepositories()} disabled={loadingRepos}><RefreshCw size={16} className={loadingRepos ? 'spinning' : ''} /></button>
          <button className="icon-button" title="Toggle light theme" onClick={() => setLightTheme(!lightTheme)}><Sun size={16} /></button>
          <div className="user-chip">{auth.avatarUrl ? <img src={auth.avatarUrl} alt="" /> : <span className="avatar-fallback">{auth.login?.slice(0, 1).toUpperCase()}</span>}<span>{auth.login}</span><button title="Sign out" onClick={async () => { await window.codexa.signOut(); setAuth({ connected: false, login: null, avatarUrl: null }); setRepositories([]) }}><LogOut size={14} /></button></div>
        </div>
      </header>

      <div className="app-body">
        <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
          <div className="sidebar-heading">
            {!collapsed && <span>LIBRARY</span>}
            <button className="icon-button subtle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
          </div>
          <button className={`nav-item ${!activeGroup && filter === 'all' ? 'active' : ''}`} onClick={() => { setActiveGroup(null); setFilter('all') }} title="All repositories"><Command size={16} />{!collapsed && <><span>All repositories</span><span className="nav-count">{repositories.length}</span></>}</button>
          <button className={`nav-item ${activeGroup === '__uncategorized__' ? 'active' : ''}`} onClick={() => { setActiveGroup('__uncategorized__'); setFilter('all') }} title="Uncategorized"><Folder size={15} />{!collapsed && <><span>Uncategorized</span><span className="nav-count">{repositories.filter((repo) => !data.assignments[String(repo.id)]?.length).length}</span></>}</button>
          <button className={`nav-item ${filter === 'favorites' ? 'active' : ''}`} onClick={() => { setActiveGroup(null); setFilter('favorites') }} title="Favorites"><Heart size={15} />{!collapsed && <><span>Favorites</span><span className="nav-count">{data.favorites.length}</span></>}</button>
          <button className={`nav-item ${filter === 'recent' ? 'active' : ''}`} onClick={() => { setActiveGroup(null); setFilter('recent') }} title="Recently updated"><RefreshCw size={15} />{!collapsed && <span>Recently updated</span>}</button>
          <button className={`nav-item ${filter === 'public' ? 'active' : ''}`} onClick={() => { setActiveGroup(null); setFilter('public') }} title="Public"><Eye size={15} />{!collapsed && <span>Public</span>}</button>
          <button className={`nav-item ${filter === 'private' ? 'active' : ''}`} onClick={() => { setActiveGroup(null); setFilter('private') }} title="Private"><LockKeyhole size={15} />{!collapsed && <span>Private</span>}</button>
          <button className={`nav-item ${filter === 'archived' ? 'active' : ''}`} onClick={() => { setActiveGroup(null); setFilter('archived') }} title="Archived"><Archive size={15} />{!collapsed && <span>Archived</span>}</button>
          {!collapsed && <div className="sidebar-section-heading"><span>YOUR FOLDERS</span><button className="icon-button subtle tiny" title="Create folder" onClick={() => { setGroupName(''); setGroupDialog({ mode: 'create' }) }}><Plus size={14} /></button></div>}
          {childGroups.map((group) => <GroupBranch key={group.id} group={group} groups={data.groups} activeId={activeGroup} collapsed={collapsed} countForGroup={countForGroup} onSelect={(id) => { setActiveGroup(id); setFilter('all') }} onDrop={(repoId, id) => { void updateData(assignToGroup(data, [repoId], id)).then((saved) => { if (saved) setNotice('Repository moved into folder') }) }} onRename={(item) => { setGroupName(item.name); setGroupDialog({ mode: 'rename', id: item.id }) }} onDelete={deleteGroup} />)}
          {!collapsed && childGroups.length === 0 && <button className="create-first-folder" onClick={() => { setGroupName(''); setGroupDialog({ mode: 'create' }) }}><FolderPlus size={15} />Create your first folder</button>}
          {!collapsed && <div className="sidebar-spacer" />}
          {!collapsed && <div className="sidebar-bottom">
            <div className="storage-note"><span className="storage-icon"><ShieldCheck size={15} /></span><div><strong>Local organization</strong><small>Groups never change GitHub</small></div></div>
            <div className="backup-actions"><button onClick={exportOrganization}>Export backup</button><button onClick={() => fileInput.current?.click()}>Restore</button></div>
            <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => void importOrganization(event.target.files?.[0])} />
            <span className="version-label">CODEXA · PRIVATE BETA</span>
          </div>}
        </aside>

        <section className="workspace">
          <div className="workspace-header">
            <div className="breadcrumbs"><button onClick={() => { setActiveGroup(null); setFilter('all') }}>Library</button>{(currentGroup || activeGroup === '__uncategorized__') && <><ChevronRight size={14} /><span>{currentGroup?.name ?? 'Uncategorized'}</span></>}</div>
            <div className="workspace-title-row">
              <div><h1>{currentGroup?.name ?? (activeGroup === '__uncategorized__' ? 'Uncategorized' : filter === 'all' ? 'All repositories' : filter === 'recent' ? 'Recently updated' : filter === 'favorites' ? 'Favorites' : filter[0].toUpperCase() + filter.slice(1))}</h1><p>{loadingRepos ? 'Syncing your repositories…' : `${visibleRepos.length} ${visibleRepos.length === 1 ? 'repository' : 'repositories'}${currentGroup || activeGroup === '__uncategorized__' ? ' in this folder' : ''}`}</p></div>
              <div className="view-tools">
                {currentGroup && <button className="secondary-button" onClick={() => { setGroupName(currentGroup.name); setGroupDialog({ mode: 'rename', id: currentGroup.id }) }}><MoreHorizontal size={15} />Manage folder</button>}
                <button className={`icon-button view-toggle ${!gridView ? 'selected' : ''}`} onClick={() => setGridView(false)} title="List view"><LayoutList size={16} /></button>
                <button className={`icon-button view-toggle ${gridView ? 'selected' : ''}`} onClick={() => setGridView(true)} title="Grid view"><Grid2X2 size={16} /></button>
              </div>
            </div>
            <div className="toolbar">
              <div className="filter-tabs">
                {(['all', 'public', 'private', 'forks'] as Filter[]).map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => { setFilter(item); if (item !== 'all') setActiveGroup(null) }}>{item === 'all' ? 'Everything' : item === 'forks' ? 'Forks' : item[0].toUpperCase() + item.slice(1)}</button>)}
              </div>
              <div className="toolbar-end">
                <button className={`secondary-button ${filterPanel ? 'pressed' : ''}`} onClick={() => setFilterPanel(!filterPanel)}><SlidersHorizontal size={14} />Filter</button>
                <label className="sort-select"><ArrowDownUp size={14} /><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} aria-label="Sort repositories"><option value="name">Name</option><option value="language">Language</option><option value="updatedAt">Last updated</option><option value="visibility">Visibility</option><option value="createdAt">Created</option></select><ChevronDown size={12} /></label>
              </div>
            </div>
            {filterPanel && <div className="filter-panel"><span>Quick filters</span><button onClick={() => setFilter('recent')}>Updated this month</button><button onClick={() => setFilter('archived')}>Archived</button><button onClick={() => { setFilter('all'); setSearch('') }}>Clear filters</button></div>}
          </div>

          {error && <div className="error-banner"><CircleHelp size={15} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
          {selected.length > 0 && <div className="bulk-toolbar"><span><strong>{selected.length}</strong> selected</span><button onClick={() => setBulkDialog('move')}><Folder size={14} />Move to folder</button><button onClick={() => setBulkDialog('archive')}><Archive size={14} />Archive</button>{repositories.some((repo) => selected.includes(repo.id) && repo.archived) && <button onClick={() => setBulkDialog('unarchive')}><Archive size={14} />Unarchive</button>}<button onClick={() => setBulkDialog('public')}><Eye size={14} />Make public</button><button onClick={() => setBulkDialog('private')}><LockKeyhole size={14} />Make private</button><button onClick={exportSelectedRepositories}><Copy size={14} />Export</button><button onClick={() => { setSelected([]) }}><X size={14} />Clear</button></div>}

          <div className={`repository-area ${gridView ? 'repository-grid' : ''}`}>
            {loadingRepos && repositories.length === 0 ? <div className="loading-state"><div className="spinner" /><span>Loading your repositories</span></div> :
              visibleRepos.length === 0 ? <div className="empty-state"><div className="empty-icon"><Folder size={25} /></div><h2>{search ? 'No repositories found' : 'Nothing here yet'}</h2><p>{search ? 'Try another name, language, or topic.' : currentGroup ? 'Drag repositories here from the library, or choose one to move.' : 'Connect a GitHub account or adjust the current filters.'}</p>{search && <button className="text-button" onClick={() => setSearch('')}>Clear search</button>}</div> :
                gridView ? <div className="repo-cards">{visibleRepos.map((repo, index) => <RepositoryCard key={repo.id} repo={repo} index={index} selected={selected.includes(repo.id)} favorite={data.favorites.includes(repo.id)} onSelect={selectRepository} onFavorite={toggleFavorite} onOpen={() => void window.codexa.openExternal(repo.htmlUrl)} />)}</div> :
                <div className="repo-table">
                  <div className="repo-table-head"><span>NAME</span><span>VISIBILITY</span><span>LANGUAGE</span><span>UPDATED</span><span /></div>
                  {visibleRepos.map((repo, index) => <RepositoryRow key={repo.id} repo={repo} index={index} selected={selected.includes(repo.id)} favorite={data.favorites.includes(repo.id)} onSelect={selectRepository} onFavorite={toggleFavorite} onOpen={() => void window.codexa.openExternal(repo.htmlUrl)} onDetails={() => setDetailId(repo.id)} />)}
                </div>}
          </div>
          <div className="statusbar"><span><span className="status-dot" style={{ background: syncError ? '#ed8c8c' : loadingRepos ? '#d5a84c' : '#87c57a' }} />{syncError ? 'Sync needs attention' : loadingRepos ? 'Syncing with GitHub' : 'Synced with GitHub'}</span><span>{repositories.length} repositories · {data.groups.length} folders</span><span>Local data only</span></div>
        </section>

        {activeRepo && <aside className="details-panel">
          <div className="detail-top"><span>DETAILS</span><button className="icon-button subtle" onClick={() => setDetailId(null)} title="Close details"><X size={16} /></button></div>
          <div className="detail-repo-icon"><GitBranch size={25} /></div>
          <div className="detail-title"><h2>{activeRepo.name}</h2><button className={`icon-button favorite-button ${data.favorites.includes(activeRepo.id) ? 'is-favorite' : ''}`} onClick={() => toggleFavorite(activeRepo.id)} title="Toggle favorite"><Heart size={16} fill={data.favorites.includes(activeRepo.id) ? 'currentColor' : 'none'} /></button></div>
          <a className="detail-owner" href="#" onClick={(event) => { event.preventDefault(); void window.codexa.openExternal(activeRepo.htmlUrl) }}>{activeRepo.fullName}<ExternalLink size={12} /></a>
          <p className="detail-description">{activeRepo.description || 'No description provided.'}</p>
          <div className="detail-badges"><span className={activeRepo.visibility === 'private' ? 'private-badge' : ''}>{activeRepo.visibility === 'private' ? <LockKeyhole size={11} /> : <Eye size={11} />}{activeRepo.visibility}</span>{activeRepo.archived && <span><Archive size={11} />archived</span>}{activeRepo.fork && <span>fork</span>}</div>
          <div className="detail-stats"><div><Star size={14} /><strong>{activeRepo.stars.toLocaleString()}</strong><small>stars</small></div><div><ArrowDownUp size={14} /><strong>{activeRepo.forks.toLocaleString()}</strong><small>forks</small></div><div><span className="language-dot" style={{ background: languageColor(activeRepo.language) }} /><strong>{activeRepo.language || '—'}</strong><small>language</small></div></div>
          <div className="detail-section"><span className="detail-label">ABOUT</span><DetailLine label="Default branch" value={activeRepo.defaultBranch} /><DetailLine label="Created" value={formatDate(activeRepo.createdAt)} /><DetailLine label="Updated" value={formatDate(activeRepo.updatedAt)} />{activeRepo.homepage && <DetailLine label="Homepage" value={activeRepo.homepage} />}</div>
          {activeRepo.topics.length > 0 && <div className="detail-section"><span className="detail-label">TOPICS</span><div className="topic-list">{activeRepo.topics.map((topic) => <span key={topic}>{topic}</span>)}</div></div>}
          <div className="detail-actions">
            <button className="secondary-button" onClick={() => void window.codexa.openExternal(activeRepo.htmlUrl)}><ExternalLink size={14} />Open on GitHub</button>
            <button className="secondary-button" onClick={() => void window.codexa.copyText(activeRepo.cloneUrl).then(() => setNotice('HTTPS clone URL copied'))}><Copy size={14} />Copy HTTPS URL</button>
            <button className="secondary-button" onClick={() => openRepoDialog('edit', activeRepo)}><Settings2 size={14} />Edit details</button>
            <button className="secondary-button" onClick={() => openRepoDialog('topics', activeRepo)}><Tag size={14} />Manage topics</button>
            <button className="secondary-button" onClick={() => {
              const next = activeRepo.archived
              if (window.confirm(`${next ? 'Unarchive' : 'Archive'} ${activeRepo.fullName}?`)) void applyRepoAction({ type: 'archive', owner: activeRepo.owner, repo: activeRepo.name, archived: !next })
            }}><Archive size={14} />{activeRepo.archived ? 'Unarchive repository' : 'Archive repository'}</button>
            <button className="secondary-button danger-action" onClick={() => {
              const visibility = activeRepo.visibility === 'private' ? 'public' : 'private'
              const message = visibility === 'public'
                ? `Make ${activeRepo.fullName} public? Its source code and accessible history may become visible to everyone.`
                : `Make ${activeRepo.fullName} private? Collaborators or integrations may lose access.`
              if (window.confirm(message)) void applyRepoAction({ type: 'visibility', owner: activeRepo.owner, repo: activeRepo.name, visibility })
            }}>{activeRepo.visibility === 'private' ? <Eye size={14} /> : <LockKeyhole size={14} />}Make {activeRepo.visibility === 'private' ? 'public' : 'private'}</button>
          </div>
        </aside>}
      </div>

      {groupDialog && <Modal title={groupDialog.mode === 'create' ? 'Create a folder' : 'Rename folder'} onClose={() => setGroupDialog(null)}>
        <label className="form-field"><span>Folder name</span><input autoFocus maxLength={64} value={groupName} onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createGroup() }} placeholder="e.g. Web development" /></label>
        {groupDialog.mode === 'create' && activeGroup && <p className="modal-hint">This will be nested inside “{currentGroup?.name}”.</p>}
        {groupDialog.mode === 'rename' && groupDialog.id && <button className="text-button delete-group" onClick={() => { const group = data.groups.find((item) => item.id === groupDialog.id); if (group) void deleteGroup(group); setGroupDialog(null) }}>Delete this folder</button>}
        <div className="modal-actions"><button className="secondary-button" onClick={() => setGroupDialog(null)}>Cancel</button><button className="primary-button" disabled={!groupName.trim() || busy} onClick={() => void createGroup()}>{groupDialog.mode === 'create' ? 'Create folder' : 'Save changes'}</button></div>
      </Modal>}

      {repoDialog && activeRepo && <Modal title={repoDialog === 'edit' ? 'Edit repository details' : 'Manage topics'} onClose={() => setRepoDialog(null)}>
        {repoDialog === 'edit' ? <>
          <label className="form-field"><span>Repository name</span><input value={repoForm.name} maxLength={100} onChange={(event) => setRepoForm({ ...repoForm, name: event.target.value })} /></label>
          <label className="form-field"><span>Description</span><textarea rows={3} maxLength={350} value={repoForm.description} onChange={(event) => setRepoForm({ ...repoForm, description: event.target.value })} /></label>
          <label className="form-field"><span>Homepage URL</span><input value={repoForm.homepage} onChange={(event) => setRepoForm({ ...repoForm, homepage: event.target.value })} placeholder="https://" /></label>
        </> : <label className="form-field"><span>Topics</span><input value={repoForm.topics} onChange={(event) => setRepoForm({ ...repoForm, topics: event.target.value })} placeholder="react, typescript, tooling" /><small>Separate topics with commas. Up to 20 topics.</small></label>}
        <div className="modal-actions"><button className="secondary-button" onClick={() => setRepoDialog(null)}>Cancel</button><button className="primary-button" disabled={busy} onClick={() => void saveRepoDialog()}>Save to GitHub</button></div>
      </Modal>}

      {bulkDialog && <Modal title={bulkDialog === 'move' ? 'Move selected repositories' : bulkDialog === 'archive' || bulkDialog === 'unarchive' ? 'Review archive operation' : 'Review visibility change'} onClose={() => setBulkDialog(null)}>
        {bulkDialog === 'move' ? <>
          <p className="modal-hint">{selected.length} repositories will be assigned to one virtual folder. Their GitHub names and locations will not change.</p>
          <div className="bulk-group-list">{data.groups.map((group) => <button key={group.id} onClick={() => void moveSelected(group.id)}><Folder size={15} /><span>{group.name}</span><span>{countForGroup(group)}</span></button>)}</div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => void moveSelected(null)}>Remove from folder</button><button className="secondary-button" onClick={() => setBulkDialog(null)}>Cancel</button></div>
        </> : <>
          <p className="modal-hint">
            {bulkDialog === 'archive' && `${selected.length} selected repositories will be archived on GitHub.`}
            {bulkDialog === 'unarchive' && `${selected.length} selected repositories will be unarchived on GitHub.`}
            {bulkDialog === 'public' && 'Making these repositories public may expose their source code and accessible history to everyone.'}
            {bulkDialog === 'private' && 'Making these repositories private may cause collaborators or integrations to lose access.'}
          </p>
          <div className="bulk-review-list">{repositories.filter((repo) => selected.includes(repo.id)).map((repo) => <div key={repo.id}><GitBranch size={14} /><span>{repo.fullName}</span><small>{repo.visibility}{repo.archived ? ' · archived' : ''}</small></div>)}</div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => setBulkDialog(null)}>Cancel</button><button className={`primary-button ${bulkDialog === 'public' ? 'warning-button' : ''}`} disabled={busy} onClick={() => {
            if (bulkDialog === 'archive') void bulkArchive(true)
            if (bulkDialog === 'unarchive') void bulkArchive(false)
            if (bulkDialog === 'public') void bulkVisibility('public')
            if (bulkDialog === 'private') void bulkVisibility('private')
          }}>{bulkDialog === 'archive' ? 'Archive repositories' : bulkDialog === 'unarchive' ? 'Unarchive repositories' : `Make ${bulkDialog}`}</button></div>
        </>}
      </Modal>}
      {(notice || busy) && <div className="toast">{busy ? <><div className="mini-spinner" />Working…</> : <><Check size={15} />{notice}</>}</div>}
    </main>
  )
}

function GroupBranch({ group, groups, activeId, collapsed, countForGroup, onSelect, onDrop, onRename, onDelete }: {
  group: Group; groups: Group[]; activeId: string | null; collapsed: boolean; countForGroup: (group: Group) => number
  onSelect: (id: string) => void; onDrop: (repoId: number, groupId: string) => void; onRename: (group: Group) => void; onDelete: (group: Group) => void
}) {
  const [open, setOpen] = useState(true)
  const [menu, setMenu] = useState(false)
  const children = groups.filter((item) => item.parentId === group.id)
  const selected = activeId === group.id
  return <div className="group-branch">
    <div className={`group-nav-row ${selected ? 'active' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = Number(event.dataTransfer.getData('text/plain')); if (id) onDrop(id, group.id) }}>
      {!collapsed && children.length > 0 && <button className="tree-chevron" onClick={() => setOpen(!open)} title={open ? 'Collapse folder' : 'Expand folder'}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>}
      <button className="group-nav" onClick={() => onSelect(group.id)} title={group.name}><Folder size={15} /><span>{!collapsed && group.name}</span>{!collapsed && <small>{countForGroup(group)}</small>}</button>
      {!collapsed && <button className="group-more" onClick={() => setMenu(!menu)} title="Folder actions"><MoreHorizontal size={14} /></button>}
      {menu && <div className="context-menu"><button onClick={() => { onRename(group); setMenu(false) }}>Rename</button><button onClick={() => { onDelete(group); setMenu(false) }}>Delete</button></div>}
    </div>
    {open && children.map((child) => <div className="nested-group" key={child.id}><GroupBranch group={child} groups={groups} activeId={activeId} collapsed={collapsed} countForGroup={countForGroup} onSelect={onSelect} onDrop={onDrop} onRename={onRename} onDelete={onDelete} /></div>)}
  </div>
}

function RepositoryRow({ repo, index, selected, favorite, onSelect, onFavorite, onOpen, onDetails }: {
  repo: Repository; index: number; selected: boolean; favorite: boolean
  onSelect: (event: MouseEvent, id: number, index: number) => void; onFavorite: (id: number) => void; onOpen: () => void; onDetails: () => void
}) {
  return <div className={`repo-row ${selected ? 'selected' : ''}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(repo.id))} onClick={(event) => onSelect(event, repo.id, index)} onDoubleClick={onOpen}>
    <div className="repo-name-cell"><button className={`favorite-star ${favorite ? 'active' : ''}`} title="Toggle favorite" onClick={(event) => { event.stopPropagation(); onFavorite(repo.id) }}><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button><div className="repo-icon"><GitBranch size={16} /></div><div className="repo-name-copy"><strong>{repo.name}</strong><span>{repo.description || repo.fullName}</span></div>{repo.fork && <span className="micro-badge">FORK</span>}</div>
    <span className="visibility-cell">{repo.visibility === 'private' ? <LockKeyhole size={12} /> : <Eye size={12} />}{repo.visibility}</span>
    <span className="language-cell">{repo.language && <i className="language-dot" style={{ background: languageColor(repo.language) }} />}{repo.language || '—'}</span>
    <span className="updated-cell">{formatDate(repo.updatedAt)}</span>
    <button className="row-open" title="Show details" onClick={(event) => { event.stopPropagation(); onDetails() }}><ChevronRight size={15} /></button>
  </div>
}

function RepositoryCard({ repo, index, selected, favorite, onSelect, onFavorite, onOpen }: {
  repo: Repository; index: number; selected: boolean; favorite: boolean
  onSelect: (event: MouseEvent, id: number, index: number) => void; onFavorite: (id: number) => void; onOpen: () => void
}) {
  return <article className={`repo-card ${selected ? 'selected' : ''}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(repo.id))} onClick={(event) => onSelect(event, repo.id, index)} onDoubleClick={onOpen}>
    <div className="card-top"><div className="repo-icon"><GitBranch size={17} /></div><button className={`favorite-star ${favorite ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); onFavorite(repo.id) }} title="Toggle favorite"><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button></div>
    <strong>{repo.name}</strong><small>{repo.owner} / {repo.name}</small><p>{repo.description || 'No description provided.'}</p>
    <div className="card-bottom"><span>{repo.language && <i className="language-dot" style={{ background: languageColor(repo.language) }} />}{repo.language || 'No language'}</span><span>{repo.visibility}</span><span><Star size={12} />{repo.stars}</span></div>
  </article>
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="detail-line"><span>{label}</span><strong>{value}</strong></div>
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button subtle" onClick={onClose} aria-label="Close"><X size={16} /></button></div>{children}</section></div>
}

function languageColor(language: string | null) {
  const colors: Record<string, string> = { TypeScript: '#3178c6', JavaScript: '#e7ca3c', Python: '#3572a5', Rust: '#dea584', Go: '#00add8', 'C#': '#68217a', HTML: '#e34c26', CSS: '#563d7c', Lua: '#000080', Java: '#b07219', Swift: '#f05138', Kotlin: '#a97bff' }
  return language ? colors[language] ?? '#8290a5' : '#8290a5'
}

export default App
