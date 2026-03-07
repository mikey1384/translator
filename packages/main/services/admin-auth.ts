export function getConfiguredAdminSecret(): string {
  return (
    String(process.env.ADMIN_API_SECRET || '').trim() ||
    String(process.env.ADMIN_DEVICE_ID || '').trim()
  );
}

export function hasConfiguredAdminSecret(): boolean {
  return getConfiguredAdminSecret().length > 0;
}
