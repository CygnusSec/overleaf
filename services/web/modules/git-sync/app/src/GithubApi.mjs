import Settings from '@overleaf/settings'

const API_VERSION = '2022-11-28'

async function request(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': API_VERSION,
      'user-agent': Settings.appName,
      ...options.headers,
    },
  })
  if (!response.ok) {
    const body = await response.text()
    const error = new Error(`GitHub API returned ${response.status}`)
    error.statusCode = response.status
    error.githubResponse = body.slice(0, 1000)
    throw error
  }
  return await response.json()
}

export async function exchangeCode(code, codeVerifier) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: Settings.githubSyncClientId,
      client_secret: Settings.githubSyncClientSecret,
      code,
      redirect_uri: new URL(
        '/oauth/github/callback',
        Settings.siteUrl
      ).toString(),
      code_verifier: codeVerifier,
    }),
  })
  const result = await response.json()
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || 'GitHub OAuth exchange failed')
  }
  return result.access_token
}

export async function getUser(token) {
  return await request('/user', token)
}

export async function getRepositories(token) {
  return await request(
    '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    token
  )
}

export async function getRepository(token, fullName) {
  return await request(`/repos/${fullName}`, token)
}
