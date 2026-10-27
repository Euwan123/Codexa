import type { AppData, Group } from './types.ts'

export function getGroupDescendantIds(groups: Group[], groupId: string): Set<string> {
  const descendants = new Set([groupId])
  let changed = true
  while (changed) {
    changed = false
    for (const group of groups) {
      if (group.parentId && descendants.has(group.parentId) && !descendants.has(group.id)) {
        descendants.add(group.id)
        changed = true
      }
    }
  }
  return descendants
}

export function getRepositoryIdsForGroup(data: AppData, groupId: string): number[] {
  const ids = getGroupDescendantIds(data.groups, groupId)
  return Object.entries(data.assignments)
    .filter(([, groups]) => groups.some((id) => ids.has(id)))
    .map(([repositoryId]) => Number(repositoryId))
    .filter(Number.isSafeInteger)
}

export function assignToGroup(data: AppData, repositoryIds: number[], groupId: string | null): AppData {
  const assignments = { ...data.assignments }
  for (const repositoryId of repositoryIds) {
    const key = String(repositoryId)
    assignments[key] = groupId ? [groupId] : []
  }
  return { ...data, assignments }
}
