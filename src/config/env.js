import path from 'node:path';

export function loadEnv(env = process.env) {
  const problems = [];
  const dashboardPassword = env.DASHBOARD_PASSWORD || '';
  const sessionSecret = env.SESSION_SECRET || '';
  if (dashboardPassword.length < 12 || dashboardPassword.length > 1024) problems.push('DASHBOARD_PASSWORD must contain 12–1024 characters.');
  if (sessionSecret.length < 32) problems.push('SESSION_SECRET must contain at least 32 characters.');

  const integer = (name, fallback, min, max) => {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
      problems.push(`${name} must be an integer from ${min} to ${max}.`);
      return fallback;
    }
    return Number(value);
  };
  const port = integer('PORT', 3000, 1, 65535);
  const maxTokensCeiling = integer('MAX_TOKENS_CEILING', 32768, 512, 1048576);
  const sessionTtlMs = integer('SESSION_TTL_HOURS', 12, 1, 168) * 3_600_000;
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) problems.push('LOG_LEVEL must be debug, info, warn, or error.');
  const trustValue = env.TRUST_PROXY ?? 'false';
  if (!['true', 'false'].includes(trustValue)) problems.push('TRUST_PROXY must be true or false.');
  const host = env.HOST || '127.0.0.1';
  if (/\s|[\x00-\x1f]/.test(host)) problems.push('HOST must be a valid hostname or IP address.');
  if (problems.length) throw new Error(`Configuration error:\n${problems.join('\n')}`);
  return { port, host, dashboardPassword, sessionSecret, storageDir: path.resolve(env.STORAGE_DIR || './storage'), logLevel, trustProxy: trustValue === 'true', maxTokensCeiling, sessionTtlMs };
}
