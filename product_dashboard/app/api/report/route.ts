import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

import {
  isFullDashboardEnabled,
  resolveCodeReaderDataDir,
  resolveNonCodeDataRoot,
} from "@/lib/dashboard-runtime"

type ReportSource = "dmm" | "code_reader_scanner"

function resolveBaseDir(source: ReportSource) {
  if (source === "code_reader_scanner") {
    return resolveCodeReaderDataDir()
  }
  return isFullDashboardEnabled() ? resolveNonCodeDataRoot() : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fileParam = searchParams.get("file")
  const sourceParam = (searchParams.get("source") ?? "dmm") as ReportSource

  if (sourceParam !== "dmm" && sourceParam !== "code_reader_scanner") {
    return NextResponse.json({ error: "Invalid report source" }, { status: 400 })
  }

  const baseDir = resolveBaseDir(sourceParam)
  if (!baseDir) {
    return NextResponse.json({ error: "Report source unavailable" }, { status: 404 })
  }

  if (!fileParam) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
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
    return new NextResponse(data, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }
}

function isPathInside(baseDir: string, filePath: string) {
  return filePath === baseDir || filePath.startsWith(`${baseDir}${path.sep}`)
}
