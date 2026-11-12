export function readStoredArray(storage, key, kind = "drafts") {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { value: [], issue: false, raw: null };
    const parsed = JSON.parse(raw);
    const valid = Array.isArray(parsed) && parsed.every(entry =>
      kind === "drafts"
        ? entry && typeof entry === "object" && !Array.isArray(entry) &&
          typeof entry.id === "string" && typeof entry.title === "string"
        : typeof entry === "string"
    );
    return valid
      ? { value: parsed, issue: false, raw }
      : { value: [], issue: true, raw };
  } catch {
    let raw = null;
    try { raw = storage.getItem(key); } catch {}
    return { value: [], issue: true, raw };
  }
}

export function writeStoredArray(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
