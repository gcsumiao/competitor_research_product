import { setTimeout as sleep } from "node:timers/promises"

import {
  evaluateBranches,
  isProtectedNeonBranch,
  selectPrunableBranches,
  type NeonBranchSummary,
} from "../lib/neon-branch-audit.ts"

const NEON_API_BASE_URL = "https://console.neon.tech/api/v2"
const DEFAULT_PROJECT_ID = "bold-haze-58127872"
const DEFAULT_BRANCH_MAX = 2
const PRUNE_PREFIXES = ["preview/"]
const FORBIDDEN_PREFIXES = ["preview/"]
const FORBIDDEN_NAMES = ["vercel-dev"]
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000

const USAGE = `Usage: pnpm neon:branch-audit [-- [--max N] [--prune [--delete <name>]... [--yes]]]

  --max N           Branch budget (default: NEON_BRANCH_MAX or ${DEFAULT_BRANCH_MAX}).
  --prune           Dry run: list prune candidates (names starting with ${PRUNE_PREFIXES.join(", ")} plus --delete names).
  --delete <name>   Also prune the branch with this exact name (repeatable; requires --prune).
  --yes             Actually delete the prune candidates (requires --prune).

Env: NEON_API_KEY (required), NEON_PROJECT_ID (default ${DEFAULT_PROJECT_ID}), NEON_BRANCH_MAX (default ${DEFAULT_BRANCH_MAX}).
Default, primary and protected branches are never pruned.`

class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}

type CliArgs = {
  max?: number
  prune: boolean
  yes: boolean
  deleteNames: string[]
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const apiKey = (process.env.NEON_API_KEY ?? "").trim()
  if (!apiKey) {
    throw new UsageError(
      "NEON_API_KEY is not set. Add it to product_dashboard/.env.local (Neon console → Account settings → API keys) or export it in the shell."
    )
  }
  const projectId = (process.env.NEON_PROJECT_ID ?? "").trim() || DEFAULT_PROJECT_ID
  const max = args.max ?? parseMax(process.env.NEON_BRANCH_MAX, "NEON_BRANCH_MAX") ?? DEFAULT_BRANCH_MAX
  const auditOpts = { max, forbiddenPrefixes: FORBIDDEN_PREFIXES, forbiddenNames: FORBIDDEN_NAMES }

  let branches = await listBranches(projectId, apiKey)
  console.log(`Neon project ${projectId}: ${branches.length} branch(es)`)
  printBranchTable(branches)

  let deleteFailures = 0
  if (args.prune) {
    const candidates = selectPrunableBranches(branches, { prefixes: PRUNE_PREFIXES, names: args.deleteNames })
    reportExplicitDeleteNames(branches, args.deleteNames)

    console.log("")
    console.log(`Prune candidates (${candidates.length}):`)
    for (const branch of candidates) {
      console.log(`  - ${branch.name} (${branch.id})`)
    }

    if (!args.yes) {
      console.log("Dry run only. Re-run with --prune --yes to delete these branches.")
    } else if (candidates.length > 0) {
      console.log("")
      for (const branch of candidates) {
        try {
          await deleteBranch(projectId, apiKey, branch.id)
          console.log(`DELETED ${branch.name} (${branch.id})`)
        } catch (error) {
          deleteFailures += 1
          console.error(`FAILED ${branch.name} (${branch.id}): ${errorMessage(error)}`)
        }
      }

      const deletedIds = new Set(candidates.map((branch) => branch.id))
      branches = await listBranches(projectId, apiKey)
      console.log("")
      console.log(`After prune: ${branches.length} branch(es)`)
      printBranchTable(branches)
      for (const branch of branches) {
        if (deletedIds.has(branch.id)) {
          console.warn(`WARNING: ${branch.name} (${branch.id}) is still listed after its delete request.`)
        }
      }
    }
  }

  const result = evaluateBranches(branches, auditOpts)
  console.log("")
  console.log(`Branch audit: ${result.ok ? "OK" : "FAIL"} (count ${result.count}, max ${max})`)
  for (const violation of result.violations) {
    console.error(`VIOLATION: ${violation}`)
  }
  if (deleteFailures > 0) {
    console.error(`${deleteFailures} branch delete(s) failed.`)
  }

  if (!result.ok || deleteFailures > 0) {
    process.exitCode = 1
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { prune: false, yes: false, deleteNames: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    // `node -r dotenv/config ... dotenv_config_path=.env.local` leaves this in argv;
    // `pnpm <script> -- ...` may forward a bare "--".
    if (value === "--" || value.startsWith("dotenv_config_")) continue

    if (value === "--max") {
      args.max = parseMax(argv[index + 1], "--max")
      index += 1
    } else if (value === "--prune") {
      args.prune = true
    } else if (value === "--yes") {
      args.yes = true
    } else if (value === "--delete") {
      const name = argv[index + 1]?.trim()
      if (!name || name.startsWith("--")) throw new UsageError("--delete requires a branch name.")
      args.deleteNames.push(name)
      index += 1
    } else if (value === "--help" || value === "-h") {
      console.log(USAGE)
      process.exit(0)
    } else {
      throw new UsageError(`Unknown argument: ${value}`)
    }
  }

  if (args.yes && !args.prune) {
    throw new UsageError("Refusing to delete: --yes only applies together with --prune.")
  }
  if (args.deleteNames.length > 0 && !args.prune) {
    throw new UsageError("--delete only applies together with --prune.")
  }

  return args
}

function parseMax(value: string | undefined, source: string) {
  if (value === undefined || value.trim() === "") {
    if (source === "--max") throw new UsageError("--max requires a non-negative integer.")
    return undefined
  }
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new UsageError(`${source} must be a non-negative integer (got ${JSON.stringify(trimmed)}).`)
  }
  return Number(trimmed)
}

function reportExplicitDeleteNames(branches: NeonBranchSummary[], names: string[]) {
  for (const name of names) {
    const matches = branches.filter((branch) => branch.name === name)
    if (matches.length === 0) {
      console.warn(`WARNING: --delete ${name} matched no branch.`)
      continue
    }
    for (const branch of matches) {
      if (isProtectedNeonBranch(branch)) {
        console.warn(`WARNING: ${branch.name} (${branch.id}) is a default/primary/protected branch and is never pruned.`)
      }
    }
  }
}

async function listBranches(projectId: string, apiKey: string): Promise<NeonBranchSummary[]> {
  const payload = await neonRequest("GET", `/projects/${encodeURIComponent(projectId)}/branches`, apiKey)
  const rawBranches = (payload as { branches?: unknown } | null)?.branches
  if (!Array.isArray(rawBranches)) {
    throw new Error("Unexpected Neon API response: missing branches array.")
  }
  return rawBranches.map(toBranchSummary)
}

async function deleteBranch(projectId: string, apiKey: string, branchId: string) {
  await neonRequest(
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
    apiKey
  )
}

function toBranchSummary(raw: unknown): NeonBranchSummary {
  const record = (raw ?? {}) as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.name !== "string") {
    throw new Error("Unexpected Neon API response: branch without string id/name.")
  }
  return {
    id: record.id,
    name: record.name,
    default: typeof record.default === "boolean" ? record.default : undefined,
    primary: typeof record.primary === "boolean" ? record.primary : undefined,
    protected: typeof record.protected === "boolean" ? record.protected : undefined,
    parent_id: typeof record.parent_id === "string" ? record.parent_id : null,
    created_at: typeof record.created_at === "string" ? record.created_at : undefined,
    current_state: typeof record.current_state === "string" ? record.current_state : undefined,
    logical_size: typeof record.logical_size === "number" ? record.logical_size : null,
  }
}

async function neonRequest(method: "GET" | "DELETE", apiPath: string, apiKey: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${NEON_API_BASE_URL}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    })

    if (response.ok) {
      const text = await response.text()
      return text ? (JSON.parse(text) as unknown) : null
    }

    // 429 = rate limited, 5xx = transient server error, 423 = the project has another
    // operation running (Neon rejects new operations until it finishes, e.g. back-to-back deletes).
    const retryable = response.status === 429 || response.status === 423 || response.status >= 500
    if (retryable && attempt < MAX_RETRIES) {
      await response.arrayBuffer().catch(() => undefined)
      const delayMs = retryDelayMs(response, attempt)
      console.warn(
        `Neon API ${method} ${apiPath} returned ${response.status}; retrying in ${delayMs}ms (retry ${attempt + 1}/${MAX_RETRIES}).`
      )
      await sleep(delayMs)
      continue
    }

    const body = await response.text().catch(() => "")
    throw new Error(
      `Neon API ${method} ${apiPath} failed: ${response.status} ${response.statusText}${body ? ` ${body.slice(0, 300)}` : ""}`
    )
  }
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get("retry-after"))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, MAX_RETRY_DELAY_MS)
  }
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS)
}

function printBranchTable(branches: NeonBranchSummary[]) {
  const headers = ["name", "id", "default", "created_at", "current_state", "logical_size"]
  const rows = branches.map((branch) => [
    branch.name,
    branch.id,
    branch.default === true || branch.primary === true ? "yes" : "",
    branch.created_at ?? "",
    branch.current_state ?? "",
    formatBytes(branch.logical_size),
  ])
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  )
  const formatRow = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()

  console.log(formatRow(headers))
  console.log(formatRow(widths.map((width) => "-".repeat(width))))
  for (const row of rows) {
    console.log(formatRow(row))
  }
}

function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number") return ""
  if (value < 1024 * 1024) return `${value} B`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(error.message)
    process.exitCode = 2
    return
  }
  console.error(errorMessage(error))
  process.exitCode = 1
})
