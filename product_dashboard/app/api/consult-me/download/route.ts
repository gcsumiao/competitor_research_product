import path from "path"
import { readFile } from "fs/promises"
import { NextResponse } from "next/server"

import { resolveSeedDeliverable } from "@/lib/consult-me/seed-reports"
import type { DeliverableType } from "@/lib/consult-me/types"

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".csv", ".pptx"])
const DEFAULT_ALLOWED_REMOTE_HOSTS = ["valyu.ai", "platform.valyu.ai", "api.valyu.ai"]
const TYPE_TO_EXTENSION: Record<string, string> = {
  pdf: ".pdf",
  docx: ".docx",
  csv: ".csv",
  pptx: ".pptx",
}

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv; charset=utf-8",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const remoteUrl = searchParams.get("remoteUrl")?.trim()
  const seedId = searchParams.get("seedId")?.trim()
  const type = normalizeType(searchParams.get("type"))
  const dispositionParam = searchParams.get("disposition")?.trim().toLowerCase()
  const disposition = dispositionParam === "inline" ? "inline" : "attachment"

  if (seedId) {
    if (!type) {
      return NextResponse.json({ error: "Missing or invalid deliverable type" }, { status: 400 })
    }
    return downloadSeededFile(seedId, type, disposition)
  }

  if (!remoteUrl) {
    return NextResponse.json({ error: "Missing remoteUrl" }, { status: 400 })
  }

  return proxyRemoteFile(remoteUrl, disposition, type)
}

async function downloadSeededFile(
  seedId: string,
  type: DeliverableType,
  disposition: "inline" | "attachment"
) {
  const seedFile = await resolveSeedDeliverable(seedId, type)
  if (!seedFile?.localPath) {
    return NextResponse.json({ error: "Seeded deliverable not found" }, { status: 404 })
  }
  const ext = path.extname(seedFile.localPath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "Unsupported local file type" }, { status: 400 })
  }
  try {
    const bytes = await readFile(seedFile.localPath)
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream"
    const fileName = ensureExtension(seedFile.fileName || `deliverable${ext}`, ext)
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "Failed to read seeded deliverable" }, { status: 500 })
  }
}

async function proxyRemoteFile(
  remoteUrl: string,
  disposition: "inline" | "attachment",
  requestedType?: keyof typeof TYPE_TO_EXTENSION
) {
  let url: URL
  try {
    url = new URL(remoteUrl)
  } catch {
    return NextResponse.json({ error: "Invalid remoteUrl" }, { status: 400 })
  }

  if (url.protocol !== "https:") {
    return NextResponse.json({ error: "Only https remoteUrl is allowed" }, { status: 400 })
  }

  const allowedHosts = parseAllowedHosts()
  if (!allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return NextResponse.json({ error: "Remote host is not allowed" }, { status: 400 })
  }

  const extFromUrl = path.extname(url.pathname).toLowerCase()
  const extFromType = requestedType ? TYPE_TO_EXTENSION[requestedType] : ""
  const ext = extFromUrl || extFromType
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "Unsupported remote file type" }, { status: 400 })
  }

  try {
    const upstream = await fetch(url.toString())
    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream download failed (${upstream.status})` }, { status: 502 })
    }
    const bytes = await upstream.arrayBuffer()
    const upstreamType = upstream.headers.get("content-type")?.trim()
    const contentType = CONTENT_TYPES[ext] ?? upstreamType ?? "application/octet-stream"
    const fallbackName = `deliverable${ext}`
    const resolvedName = ensureExtension(path.basename(url.pathname) || fallbackName, ext)
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${disposition}; filename="${resolvedName}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "Failed to fetch remote deliverable" }, { status: 502 })
  }
}

function parseAllowedHosts() {
  const fromEnv = (process.env.CONSULT_ME_REMOTE_DOWNLOAD_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (!fromEnv.length) return DEFAULT_ALLOWED_REMOTE_HOSTS
  return Array.from(new Set([...DEFAULT_ALLOWED_REMOTE_HOSTS, ...fromEnv]))
}

function normalizeType(value: string | null): DeliverableType | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized in TYPE_TO_EXTENSION) {
    return normalized as DeliverableType
  }
  return undefined
}

function ensureExtension(fileName: string, ext: string) {
  if (!fileName) return `deliverable${ext}`
  if (fileName.toLowerCase().endsWith(ext)) return fileName
  return `${fileName}${ext}`
}
