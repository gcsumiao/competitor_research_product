// Pure helpers for auditing the Neon branch budget. No I/O and no process.env reads:
// scripts/neon-branch-audit.mts fetches branches from the Neon API and passes them in.

export type NeonBranchSummary = {
  id: string
  name: string
  default?: boolean
  primary?: boolean
  protected?: boolean
  parent_id?: string | null
  created_at?: string
  current_state?: string
  logical_size?: number | null
}

export type NeonBranchAuditResult = {
  ok: boolean
  count: number
  violations: string[]
}

export function evaluateBranches(
  branches: NeonBranchSummary[],
  opts: { max: number; forbiddenPrefixes: string[]; forbiddenNames: string[] }
): NeonBranchAuditResult {
  const violations: string[] = []
  const count = branches.length

  if (count > opts.max) {
    violations.push(`Branch count ${count} exceeds the budget of ${opts.max}.`)
  }

  for (const branch of branches) {
    const prefix = opts.forbiddenPrefixes.find((candidate) => branch.name.startsWith(candidate))
    if (prefix !== undefined) {
      violations.push(`Branch "${branch.name}" (${branch.id}) uses forbidden prefix "${prefix}".`)
    }
    if (opts.forbiddenNames.includes(branch.name)) {
      violations.push(`Branch "${branch.name}" (${branch.id}) uses a forbidden name.`)
    }
  }

  return { ok: violations.length === 0, count, violations }
}

export function isProtectedNeonBranch(branch: NeonBranchSummary) {
  return branch.default === true || branch.primary === true || branch.protected === true
}

export function selectPrunableBranches(
  branches: NeonBranchSummary[],
  opts: { prefixes: string[]; names: string[] }
): NeonBranchSummary[] {
  return branches.filter((branch) => {
    if (isProtectedNeonBranch(branch)) return false
    return (
      opts.prefixes.some((prefix) => branch.name.startsWith(prefix)) || opts.names.includes(branch.name)
    )
  })
}
