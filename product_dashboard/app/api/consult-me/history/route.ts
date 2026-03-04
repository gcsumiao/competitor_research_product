import { NextResponse } from "next/server"

import {
  deleteConsultMeHistoryByCompany,
  deleteConsultMeHistoryByTask,
  listConsultMeHistory,
} from "@/lib/consult-me/history-store"

export async function GET() {
  try {
    const history = await listConsultMeHistory()
    return NextResponse.json(history)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load consult-me history" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get("taskId")?.trim() ?? ""
    const companyKey = searchParams.get("companyKey")?.trim() ?? ""

    if (!taskId && !companyKey) {
      return NextResponse.json(
        { error: "Missing delete target. Provide taskId or companyKey." },
        { status: 400 }
      )
    }

    if (taskId) {
      const result = await deleteConsultMeHistoryByTask(taskId)
      return NextResponse.json(result)
    }

    const result = await deleteConsultMeHistoryByCompany(companyKey)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete consult-me history" },
      { status: 500 }
    )
  }
}
