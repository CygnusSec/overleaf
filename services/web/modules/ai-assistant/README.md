# AI Assistant

This module provides two types of AI connections:

- personal connections: users choose an enabled provider and store their own
  encrypted API key;
- shared Local AI connections: site administrators configure an
  OpenAI-compatible endpoint once for all users.
- Codex connections: users sign in with their own ChatGPT account through the
  official Codex device authorization flow; no OpenAI API key is required.

## Configuration

Generate the server-side encryption key:

```sh
openssl rand -base64 32
```

Set the following environment variables:

```env
AI_INTEGRATION_ENABLED=true
AI_CREDENTIAL_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
AI_PROVIDERS_CONFIG=[{"id":"openai","name":"OpenAI","enabled":true,"adapter":"openai","baseUrl":"https://api.openai.com/v1","defaultModel":"gpt-5.6-sol","models":["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4","gpt-5.4-mini"]}]
CODEX_LOGIN_ENABLED=true
CODEX_DEFAULT_MODEL=gpt-5.6-sol
CODEX_MODELS=["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-5.4","gpt-5.4-mini"]
```

`AI_PROVIDERS_CONFIG` is only a catalog. It must never contain user API keys.
Supported adapters are `openai`, `openai-compatible`, `anthropic`, `gemini`,
and `ollama`. New providers that implement the OpenAI chat-completions protocol
can be added without changing application code.

Keep `AI_CREDENTIAL_ENCRYPTION_KEY` outside the database and include it in the
server's protected backup procedure. Existing credentials cannot be decrypted
if this key is lost.

Codex OAuth state is stored under `/var/lib/overleaf/codex/<user-id>` with a
separate `CODEX_HOME` for every Overleaf user. Keep that directory in the
normal `/var/lib/overleaf` backup. Never mount one shared host `~/.codex`
directory into the container.

## Usage

Users manage personal connections under **Account settings → AI connections**.
Administrators manage shared endpoints under **Admin → AI Providers**.

The editor has a dedicated **AI Assistant** rail tab for read-only questions and
reviewed project edits. An edit proposal can replace the current LaTeX document
and create new top-level files or folders. Nothing is applied until the user
explicitly accepts the complete plan. Existing project files are never silently
overwritten, and a stale current-document proposal is rejected when the
document changes while the AI request is running.
