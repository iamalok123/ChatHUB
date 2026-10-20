import type { Branch } from '../api/types'

export type GraphPoint = { x: number; y: number }

const COLUMN_WIDTH = 278
const ROW_HEIGHT = 132

export function layoutBranchGraph(branches: Branch[]): Map<string, GraphPoint> {
  const byId = new Map(branches.map((branch) => [branch.id, branch]))
  const depthById = new Map<string, number>()

  const depthOf = (branch: Branch, seen = new Set<string>()): number => {
    const cached = depthById.get(branch.id)
    if (cached !== undefined) return cached
    if (seen.has(branch.id) || !branch.parent_branch_id) {
      depthById.set(branch.id, 0)
      return 0
    }
    const parent = byId.get(branch.parent_branch_id)
    if (!parent) {
      depthById.set(branch.id, 0)
      return 0
    }
    seen.add(branch.id)
    const depth = depthOf(parent, seen) + 1
    depthById.set(branch.id, depth)
    return depth
  }

  const columns = new Map<number, Branch[]>()
  for (const branch of branches) {
    const depth = depthOf(branch)
    const column = columns.get(depth) ?? []
    column.push(branch)
    columns.set(depth, column)
  }

  const positions = new Map<string, GraphPoint>()
  for (const [depth, column] of columns) {
    column.sort((a, b) => a.created_at.localeCompare(b.created_at))
    column.forEach((branch, index) => {
      positions.set(branch.id, {
        x: depth * COLUMN_WIDTH,
        y: (index - (column.length - 1) / 2) * ROW_HEIGHT,
      })
    })
  }
  return positions
}
