import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assignToGroup, getRepositoryIdsForGroup } from './groups.ts'
import { appDataSchema, type AppData } from './types.ts'

const base: AppData = {
  groups: [
    { id: 'dev', name: 'Development', parentId: null },
    { id: 'web', name: 'Web', parentId: 'dev' },
  ],
  assignments: { '1': ['web'], '2': ['dev'], '3': [] },
  favorites: [],
}

describe('virtual group organization', () => {
  it('includes repositories assigned to nested groups', () => {
    assert.deepEqual(getRepositoryIdsForGroup(base, 'dev'), [1, 2])
  })

  it('moves a repository between groups without changing repository metadata', () => {
    const moved = assignToGroup(base, [1], 'dev')
    assert.deepEqual(moved.assignments['1'], ['dev'])
    assert.deepEqual(base.assignments['1'], ['web'])
  })

  it('removes a group assignment without deleting the repository', () => {
    const moved = assignToGroup(base, [2], null)
    assert.deepEqual(moved.assignments['2'], [])
  })

  it('rejects invalid group cycles and missing references', () => {
    assert.equal(appDataSchema.safeParse({
      groups: [
        { id: 'one', name: 'One', parentId: 'two' },
        { id: 'two', name: 'Two', parentId: 'one' },
      ],
      assignments: { '1': ['missing'] },
      favorites: [],
    }).success, false)
  })
})
