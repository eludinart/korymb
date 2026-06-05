type ThreadMsg = { role?: string; content?: string };

/** Dernier tour utilisateur sans réponse CIO enregistrée dans le fil. */
export function threadHasPendingCioTurn(messages: unknown): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = String((messages[i] as ThreadMsg).role || "").toLowerCase();
    if (role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return false;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const role = String((messages[i] as ThreadMsg).role || "").toLowerCase();
    if (role !== "user" && role !== "system") return false;
  }
  return true;
}

export function canResumeMissionCio(
  jobStatus: string,
  missionClosed: boolean,
  hasPendingTurn = false,
): boolean {
  const st = String(jobStatus || "").toLowerCase();
  return (
    !missionClosed &&
    st !== "awaiting_validation" &&
    st !== "cancelled" &&
    (st === "completed" ||
      st.startsWith("error") ||
      st === "running" ||
      st === "pending" ||
      hasPendingTurn)
  );
}
