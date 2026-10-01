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

export type CursorPage<T> = {
  items: T[]
  next?: string | null
}

// Follows a cursor-paginated listing until a page has no `next` cursor or comes back empty,
// and returns every page's items in order. Fails hard (instead of returning a possibly
// truncated list) when a cursor repeats or the page cap is hit, so a misbehaving API cannot
// loop forever or silently drop branches from the budget count.
export async function collectCursorPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
  opts: { maxPages?: number } = {}
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 1_000
  const items: T[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 1; ; page += 1) {
    const result = await fetchPage(cursor)
    items.push(...result.items)

    const next = result.next ?? ""
    if (next === "" || result.items.length === 0) return items
    if (seenCursors.has(next)) {
      throw new Error(
        `Pagination cursor ${JSON.stringify(next)} repeated after page ${page}; refusing to continue with a possibly incomplete list.`
      )
    }
    if (page >= maxPages) {
      throw new Error(`Pagination did not finish within ${maxPages} pages; refusing to continue with a possibly incomplete list.`)
    }
    seenCursors.add(next)
    cursor = next
  }
}
