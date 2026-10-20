import type { Branch } from '../api/types'

export function branchLineage(branches: Branch[], branchId: string): Branch[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch]))
  const chain: Branch[] = []
  const seen = new Set<string>()
  let current = byId.get(branchId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parent_branch_id
      ? byId.get(current.parent_branch_id)
      : undefined
  }
  return chain
}

export function branchAncestors(branches: Branch[], branchId: string): Branch[] {
  return branchLineage(branches, branchId).slice(0, -1).reverse()
}
