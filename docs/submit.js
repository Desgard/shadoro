import { FIELD_IDS, MAX_URL_LENGTH, buildIssueUrl, validate } from './issue-url.js?v=77d39bbe';

const form = document.getElementById('submission');
const error = document.getElementById('form-error');

function showError(message, id) {
  error.textContent = message;
  error.hidden = false;
  if (id) form.elements[id].focus();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  error.hidden = true;
  const values = Object.fromEntries(FIELD_IDS.map((id) => [id, form.elements[id].value.trim()]));
  const problem = validate(values);
  if (problem) return showError(problem.message, problem.id);
  const url = buildIssueUrl(values);
  if (url.length > MAX_URL_LENGTH) return showError('内容太长，请精简备注，或只保留链接本身', 'note');
  window.location.assign(url);
});
