import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose

const EncryptedCredentialSchema = new Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
  },
  { _id: false }
)

const AiUserConnectionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    providerId: { type: String, required: true },
    displayName: { type: String, required: true },
    credential: { type: EncryptedCredentialSchema, required: true },
    model: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
  },
  { collection: 'aiUserConnections', minimize: false }
)
AiUserConnectionSchema.index(
  { userId: 1, providerId: 1, displayName: 1 },
  { unique: true }
)

const AiSystemProviderSchema = new Schema(
  {
    name: { type: String, required: true },
    adapter: {
      type: String,
      enum: ['openai-compatible', 'ollama'],
      required: true,
    },
    baseUrl: { type: String, required: true },
    credential: { type: EncryptedCredentialSchema },
    model: { type: String, required: true },
    enabled: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: Schema.Types.ObjectId, required: true },
  },
  { collection: 'aiSystemProviders', minimize: false }
)

const AiCodexSettingsSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    model: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'aiCodexSettings', minimize: false }
)

const AiConversationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, required: true, index: true },
    messages: [
      {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        mode: { type: String, enum: ['ask', 'edit'], default: 'ask' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'aiConversations', minimize: false }
)
AiConversationSchema.index({ userId: 1, projectId: 1 }, { unique: true })

export const AiUserConnection = mongoose.model(
  'AiUserConnection',
  AiUserConnectionSchema
)
export const AiSystemProvider = mongoose.model(
  'AiSystemProvider',
  AiSystemProviderSchema
)
export const AiCodexSettings = mongoose.model(
  'AiCodexSettings',
  AiCodexSettingsSchema
)
export const AiConversation = mongoose.model(
  'AiConversation',
  AiConversationSchema
)
