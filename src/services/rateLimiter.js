export function computeBackoffDelay(retryNumber, { baseMs = 500, capMs = 10_000, random = Math.random } = {}) {
  const exponential = Math.min(capMs, baseMs * (2 ** retryNumber));
  return Math.floor(exponential + (random() * exponential * 0.25));
}

export function isRetryableProviderError(error) {
  const status = error?.status;
  if (status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599)) return true;
  if (isAbortError(error)) return false;
  const errorClass = error?.constructor?.name;
  if (['APIConnectionTimeoutError', 'APIUserAbortError'].includes(errorClass)) return false;
  if (errorClass === 'APIConnectionError') return true;
  return status === undefined && [
    'APIConnectionError', 'FetchError', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN',
    'ENOTFOUND', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
  ].includes(error?.name ?? error?.code);
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
    || error?.constructor?.name === 'APIUserAbortError';
}
