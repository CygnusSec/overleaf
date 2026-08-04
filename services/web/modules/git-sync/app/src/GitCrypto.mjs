import crypto from 'node:crypto'
import Settings from '@overleaf/settings'

function getKey() {
  const key = Buffer.from(Settings.gitIntegrationEncryptionKey || '', 'base64')
  if (key.length !== 32) {
    throw new Error(
      'GIT_INTEGRATION_ENCRYPTION_KEY must be a base64 encoded 32-byte key'
    )
  }
  return key
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptSecret(value) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(value.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
