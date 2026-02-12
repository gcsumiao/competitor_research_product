import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

const BASE_DIRS = {
  dmm: path.resolve(process.cwd(), "..", "DMM_h10"),
  code_reader_scanner: path.resolve(process.cwd(), "data", "code_reader_scanner"),
} as const

type ReportSource = keyof typeof BASE_DIRS

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fileParam = searchParams.get("file")
  const sourceParam = (searchParams.get("source") ?? "dmm") as ReportSource

  if (!(sourceParam in BASE_DIRS)) {
    return NextResponse.json({ error: "Invalid report source" }, { status: 400 })
  }

  const baseDir = BASE_DIRS[sourceParam]

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
