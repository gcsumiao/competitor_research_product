import { NextResponse } from "next/server"

import { getResearchTaskStatus } from "@/lib/consult-me/task-store"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const taskId = searchParams.get("taskId")?.trim()
  if (!taskId) {
    return NextResponse.json({ error: "Missing taskId" }, { status: 400 })
  }

  try {
    const status = await getResearchTaskStatus(taskId)
    return NextResponse.json(status)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load public task status"
    const statusCode = isNotFoundError(message) ? 404 : 500
    return NextResponse.json(
      { error: message },
      { status: statusCode }
    )
  }
}

function isNotFoundError(message: string) {
  return message.includes("404") || /not found/i.test(message)
}
