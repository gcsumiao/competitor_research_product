const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z(""$\d])/
const SNAPSHOT_PREFIX = /^\(Snapshot used:[^)]*\)\s*/

export type FinalizedAnswerText = {
  answer: string
  headline: string
  answerRest: string
}

export function finalizeAnswerText(answer: string): FinalizedAnswerText {
  const prefixFreeAnswer = answer.replace(SNAPSHOT_PREFIX, "")
  const boundary = prefixFreeAnswer.match(SENTENCE_BOUNDARY)

  if (!boundary || boundary.index === undefined) {
    return {
      answer: prefixFreeAnswer,
      headline: prefixFreeAnswer,
      answerRest: "",
    }
  }

  const headline = prefixFreeAnswer.slice(0, boundary.index).trim()
  if (headline.length < 20) {
    return {
      answer: prefixFreeAnswer,
      headline: prefixFreeAnswer,
      answerRest: "",
    }
  }

  return {
    answer: prefixFreeAnswer,
    headline,
    answerRest: prefixFreeAnswer
      .slice(boundary.index + boundary[0].length)
      .trim(),
  }
}

export function withFinalizedAnswer<T extends { answer: string }>(
  response: T
): T & FinalizedAnswerText {
  return {
    ...response,
    ...finalizeAnswerText(response.answer),
  }
}
