import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

const BASE_DIR = path.resolve(process.cwd(), "..", "market_deep_research")
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".csv", ".pptx"])

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv; charset=utf-8",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const brand = searchParams.get("brand")?.trim()
  const fileName = searchParams.get("file")?.trim()
  const dispositionParam = searchParams.get("disposition")?.trim().toLowerCase()
  const disposition = dispositionParam === "inline" ? "inline" : "attachment"

  if (!brand || !/^[a-z0-9_-]+$/i.test(brand)) {
    return NextResponse.json({ error: "Invalid brand" }, { status: 400 })
  }
  if (!fileName) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
  }

  const brandDir = path.resolve(BASE_DIR, brand)
  if (!isPathInside(BASE_DIR, brandDir)) {
    return NextResponse.json({ error: "Invalid brand path" }, { status: 400 })
  }

  const resolved = path.resolve(brandDir, fileName)
  if (!isPathInside(brandDir, resolved)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 })
  }

  const ext = path.extname(resolved).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
  }

  try {
    const data = await readFile(resolved)
    return new NextResponse(data, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Content-Disposition": `${disposition}; filename="${path.basename(resolved)}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }
}

function isPathInside(baseDir: string, filePath: string) {
  return filePath === baseDir || filePath.startsWith(`${baseDir}${path.sep}`)
}
