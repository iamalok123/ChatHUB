import { expect, it } from 'vitest'

import type { Branch } from '../api/types'
import { layoutBranchGraph } from '../lib/graphLayout'

function branch(id: string, parentBranchId: string | null, createdAt: string): Branch {
  return {
    id,
    space_id: 's1',
    name: id,
    parent_branch_id: parentBranchId,
    fork_commit_id: parentBranchId ? 'c1' : null,
    head_commit_id: 'c1',
    system_prompt: '',
    persona: '',
    model: null,
    thinking_level: 'medium',
    top_k: 6,
    memory_mode: 'review',
    color: null,
    archived: false,
    created_at: createdAt,
    is_root: parentBranchId === null,
    message_count: 0,
    memory_count: 0,
  }
}

it('lays branches out by lineage depth and centers siblings', () => {
  const positions = layoutBranchGraph([
    branch('main', null, '2026-01-01T00:00:00.000Z'),
    branch('first', 'main', '2026-01-02T00:00:00.000Z'),
    branch('second', 'main', '2026-01-03T00:00:00.000Z'),
    branch('grandchild', 'first', '2026-01-04T00:00:00.000Z'),
  ])

  expect(positions.get('main')).toEqual({ x: 0, y: 0 })
  expect(positions.get('first')?.x).toBe(278)
  expect(positions.get('second')?.x).toBe(278)
  expect(positions.get('first')?.y).toBe(-66)
  expect(positions.get('second')?.y).toBe(66)
  expect(positions.get('grandchild')).toEqual({ x: 556, y: 0 })
})

it('handles cycles and orphans without dropping branches', () => {
  const positions = layoutBranchGraph([
    branch('main', null, '2026-01-01T00:00:00.000Z'),
    branch('orphan', 'missing', '2026-01-02T00:00:00.000Z'),
    branch('loop-a', 'loop-b', '2026-01-03T00:00:00.000Z'),
    branch('loop-b', 'loop-a', '2026-01-04T00:00:00.000Z'),
  ])

  expect(positions.size).toBe(4)
  expect(positions.get('main')?.x).toBe(0)
  expect(positions.get('orphan')?.x).toBe(0)
})
