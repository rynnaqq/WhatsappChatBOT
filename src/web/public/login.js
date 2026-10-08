const form = document.querySelector('#login-form');
const input = document.querySelector('#password');
const submit = document.querySelector('#login-submit');
const error = document.querySelector('#login-error');
const reveal = document.querySelector('#reveal-password');

reveal.addEventListener('click', () => {
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  reveal.textContent = visible ? 'Hide' : 'Show';
  reveal.setAttribute('aria-pressed', String(visible));
});
input.addEventListener('input', () => { error.textContent = ''; input.removeAttribute('aria-invalid'); });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: input.value }), signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not sign in. Try again.');
    input.value = '';
    location.assign('/');
  } catch (failure) {
    error.textContent = failure.name === 'AbortError' ? 'The request timed out. Try again.' : failure.message;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  } finally {
    clearTimeout(timer);
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});
