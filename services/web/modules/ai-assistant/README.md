# AI Assistant

This module provides two types of AI connections:

- personal connections: users choose an enabled provider and store their own
  encrypted API key;
- shared Local AI connections: site administrators configure an
  OpenAI-compatible endpoint once for all users.

## Configuration

Generate the server-side encryption key:

```sh
openssl rand -base64 32
```

Set the following environment variables:

```env
AI_INTEGRATION_ENABLED=true
AI_CREDENTIAL_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
AI_PROVIDERS_CONFIG=[{"id":"openai","name":"OpenAI","enabled":true,"adapter":"openai","baseUrl":"https://api.openai.com/v1","defaultModel":"gpt-5.4","models":["gpt-5.4"]}]
```

`AI_PROVIDERS_CONFIG` is only a catalog. It must never contain user API keys.
Supported adapters are `openai`, `openai-compatible`, `anthropic`, `gemini`,
and `ollama`. New providers that implement the OpenAI chat-completions protocol
can be added without changing application code.

Keep `AI_CREDENTIAL_ENCRYPTION_KEY` outside the database and include it in the
server's protected backup procedure. Existing credentials cannot be decrypted
if this key is lost.

## Usage

Users manage personal connections under **Account settings → AI connections**.
Administrators manage shared endpoints under **Admin → AI Providers**.

The editor has a dedicated **AI Assistant** rail tab for read-only questions and
reviewed edits. Edit responses are not applied until the user explicitly
accepts them. If the document changes while a response is being generated, the
stale proposal is rejected instead of overwriting newer collaborative edits.
