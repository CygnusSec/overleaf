import crypto from 'node:crypto'
import Settings from '@overleaf/settings'

function encryptionKey() {
  const key = Buffer.from(Settings.aiCredentialEncryptionKey || '', 'base64')
  if (key.length !== 32) {
    throw new Error(
      'AI_CREDENTIAL_ENCRYPTION_KEY must be a base64 encoded 32-byte key'
    )
  }
  return key
}

export function encryptCredential(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
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

export function decryptCredential(value) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(value.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
