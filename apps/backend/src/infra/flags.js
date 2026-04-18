export function isPhase2Enabled() {
  const raw = process.env.FEATURE_PHASE2;
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isPhase3Enabled() {
  const raw = process.env.PREVIEWS_ENABLED;
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
