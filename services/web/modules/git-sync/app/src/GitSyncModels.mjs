import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'

const { Schema } = mongoose

const GithubConnectionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    githubUserId: { type: Number, required: true },
    login: { type: String, required: true },
    token: {
      ciphertext: { type: String, required: true },
      iv: { type: String, required: true },
      tag: { type: String, required: true },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'githubConnections', minimize: false }
)

const GitProjectLinkSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    ownerId: { type: Schema.Types.ObjectId, required: true, index: true },
    repositoryFullName: { type: String, required: true },
    cloneUrl: { type: String, required: true },
    branch: { type: String, required: true },
    lastSyncedCommit: { type: String },
    lastSyncedAt: { type: Date },
    lastSyncDirection: { type: String, enum: ['pull', 'push'] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'gitProjectLinks', minimize: false }
)

export const GithubConnection = mongoose.model(
  'GithubConnection',
  GithubConnectionSchema
)
export const GitProjectLink = mongoose.model(
  'GitProjectLink',
  GitProjectLinkSchema
)
