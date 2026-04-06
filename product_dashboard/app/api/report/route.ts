import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

import type { CategoryId } from "@/lib/competitor-data"
import { getSourceArtifactByPath } from "@/lib/db/source-artifacts"
import {
  isFullDashboardEnabled,
  isPostgresDashboardSource,
  resolveCodeReaderDataDir,
  resolveNonCodeDataRoot,
} from "@/lib/dashboard-runtime"
import { isNonCodeCategoryId } from "@/lib/non-code-category-config"

type ReportSource = CategoryId

function resolveBaseDir(source: ReportSource) {
  if (source === "code_reader_scanner") {
    return resolveCodeReaderDataDir()
  }
  return isFullDashboardEnabled() && isNonCodeCategoryId(source) ? resolveNonCodeDataRoot() : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fileParam = searchParams.get("file")
  const sourceParam = (searchParams.get("source") ?? "code_reader_scanner") as ReportSource

  if (sourceParam !== "code_reader_scanner" && !isNonCodeCategoryId(sourceParam)) {
    return NextResponse.json({ error: "Invalid report source" }, { status: 400 })
  }

  if (!fileParam) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
  }

  if (isPostgresDashboardSource()) {
    if (path.extname(fileParam).toLowerCase() !== ".xlsx") {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
    }
    const artifact = await getSourceArtifactByPath(fileParam)
    if (artifact) {
      return new NextResponse(new Uint8Array(artifact.content), {
        headers: {
          "Content-Type": artifact.mediaType,
          "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        },
      })
    }

    if (sourceParam === "code_reader_scanner") {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    return readReportFromFilesystem(fileParam, sourceParam)
  }

  return readReportFromFilesystem(fileParam, sourceParam)
}

function isPathInside(baseDir: string, filePath: string) {
  return filePath === baseDir || filePath.startsWith(`${baseDir}${path.sep}`)
}

async function readReportFromFilesystem(fileParam: string, sourceParam: ReportSource) {
  const baseDir = resolveBaseDir(sourceParam)
  if (!baseDir) {
    return NextResponse.json({ error: "Report source unavailable" }, { status: 404 })
  }

  const resolved = path.resolve(baseDir, fileParam)
  if (!isPathInside(baseDir, resolved)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
  }

  if (path.extname(resolved).toLowerCase() !== ".xlsx") {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
  }

  try {
    const data = await readFile(resolved)
    const filename = path.basename(resolved)
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }
}
