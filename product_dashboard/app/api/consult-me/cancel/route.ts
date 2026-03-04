import { NextResponse } from "next/server"

import { cancelResearchTask } from "@/lib/consult-me/task-store"

type CancelRequest = {
  taskId?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CancelRequest
    const taskId = body.taskId?.trim()
    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 })
    }

    const status = await cancelResearchTask(taskId)
    return NextResponse.json(status)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel task"
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
