import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

const BASE_DIR = path.resolve(process.cwd(), "..", "DMM_h10")

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fileParam = searchParams.get("file")
  if (!fileParam) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 })
  }

  const resolved = path.resolve(BASE_DIR, fileParam)
  if (!resolved.startsWith(BASE_DIR)) {
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
  } catch (error) {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }
}
