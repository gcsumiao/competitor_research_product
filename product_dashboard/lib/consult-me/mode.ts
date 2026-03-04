import type { ConsultMeMode } from "@/lib/consult-me/types"

export function getConsultMeMode(): ConsultMeMode {
  return "self_hosted"
}

export function hasValyuApiKey() {
  return Boolean(process.env.VALYU_API_KEY?.trim())
}

export function assertValyuApiKeyConfigured() {
  if (!hasValyuApiKey()) {
    throw new Error("Consult Me requires VALYU_API_KEY in self-hosted mode.")
  }
}
