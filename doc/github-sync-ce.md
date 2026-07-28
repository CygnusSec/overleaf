# GitHub Sync for Overleaf Community Edition

This project includes an in-app GitHub integration similar to the GitHub Sync
flow in Overleaf Cloud:

- connect an Overleaf account to GitHub using OAuth;
- import a GitHub repository from the **New Project** menu;
- link an existing Overleaf project to a GitHub repository;
- pull a repository branch into Overleaf;
- commit and push Overleaf project files to GitHub.

The integration uses the existing Overleaf domain. It does not require a
separate Git Bridge domain.

## 1. Create a GitHub OAuth App

Open GitHub **Settings → Developer settings → OAuth Apps → New OAuth App** and
use:

- **Application name:** your Overleaf deployment name
- **Homepage URL:** `https://docs.cygnussec.tech`
- **Authorization callback URL:**
  `https://docs.cygnussec.tech/oauth/github/callback`

For another deployment, replace `https://docs.cygnussec.tech` with the exact
value of `OVERLEAF_SITE_URL`.

## 2. Configure the deployment

Copy the OAuth App credentials into `.env`:

```dotenv
GIT_INTEGRATION_ENABLED=true
GIT_INTEGRATION_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
GITHUB_SYNC_CLIENT_ID=<github-oauth-client-id>
GITHUB_SYNC_CLIENT_SECRET=<github-oauth-client-secret>
```

Generate the encryption key once and keep it stable:

```sh
openssl rand -base64 32
```

Changing this key invalidates all GitHub access tokens already encrypted in
MongoDB. OAuth credentials and the encryption key must not be committed.

The OAuth App requests GitHub's `repo` scope so users can select and sync both
public and private repositories to which they have access.

## 3. Build and start

```sh
docker build -f server-ce/Dockerfile -t sharelatex/sharelatex:dev .
docker compose up -d
```

## Sync behavior and limits

- Only a project owner can link or synchronize a repository.
- Pull replaces the current Overleaf project files with the selected GitHub
  branch. The UI asks for confirmation first.
- Push clones the latest branch, creates a normal commit, and performs a
  non-force push.
- Symbolic links are rejected.
- A repository is limited to 2,000 files and 50 MB per file.
- GitHub tokens are encrypted at rest with AES-256-GCM.
