import { expressify } from '@overleaf/promise-utils'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'

function userId(req) {
  const id = SessionManager.getLoggedInUserId(req.session)
  if (!id) {
    throw new Error('User is not logged in')
  }
  return id
}

async function formattedUser(id) {
  const user = await UserInfoManager.promises.getPersonalInfo(id)
  return UserInfoController.formatPersonalInfo(user)
}

async function getThreads(req, res) {
  const threads = await ChatApiHandler.promises.getThreads(
    req.params.project_id
  )
  await ChatManager.promises.injectUserInfoIntoThreads(threads)
  res.json(threads)
}

async function getProjectRanges(req, res) {
  const ranges = await DocumentUpdaterHandler.promises.getProjectRanges(
    req.params.project_id
  )
  res.json(ranges)
}

async function sendComment(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const id = userId(req)
  const message = await ChatApiHandler.promises.sendComment(
    projectId,
    threadId,
    id,
    req.body.content
  )
  message.user = await formattedUser(id)
  await EditorRealTimeController.emitToRoom(
    projectId,
    'new-comment',
    threadId,
    message
  )
  res.status(201).json(message)
}

async function resolveThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params
  const id = userId(req)
  await Promise.all([
    DocumentUpdaterHandler.promises.resolveThread(
      projectId,
      docId,
      threadId,
      id
    ),
    ChatApiHandler.promises.resolveThread(projectId, threadId, id),
  ])
  await EditorRealTimeController.emitToRoom(
    projectId,
    'resolve-thread',
    threadId,
    await formattedUser(id)
  )
  res.sendStatus(204)
}

async function reopenThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params
  const id = userId(req)
  await Promise.all([
    DocumentUpdaterHandler.promises.reopenThread(
      projectId,
      docId,
      threadId,
      id
    ),
    ChatApiHandler.promises.reopenThread(projectId, threadId),
  ])
  await EditorRealTimeController.emitToRoom(
    projectId,
    'reopen-thread',
    threadId
  )
  res.sendStatus(204)
}

async function deleteThread(req, res) {
  const {
    project_id: projectId,
    doc_id: docId,
    thread_id: threadId,
  } = req.params
  const id = userId(req)
  await Promise.all([
    DocumentUpdaterHandler.promises.deleteThread(
      projectId,
      docId,
      threadId,
      id
    ),
    ChatApiHandler.promises.deleteThread(projectId, threadId),
  ])
  await EditorRealTimeController.emitToRoom(
    projectId,
    'delete-thread',
    threadId
  )
  res.sendStatus(204)
}

async function editMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  await ChatApiHandler.promises.editMessage(
    projectId,
    threadId,
    messageId,
    userId(req),
    req.body.content
  )
  await EditorRealTimeController.emitToRoom(
    projectId,
    'edit-message',
    threadId,
    messageId,
    req.body.content
  )
  res.sendStatus(204)
}

async function deleteMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId)
  await EditorRealTimeController.emitToRoom(
    projectId,
    'delete-message',
    threadId,
    messageId
  )
  res.sendStatus(204)
}

async function deleteOwnMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  await ChatApiHandler.promises.deleteUserMessage(
    projectId,
    threadId,
    userId(req),
    messageId
  )
  await EditorRealTimeController.emitToRoom(
    projectId,
    'delete-message',
    threadId,
    messageId
  )
  res.sendStatus(204)
}

async function acceptChanges(req, res) {
  const { project_id: projectId, doc_id: docId } = req.params
  const changeIds = Array.isArray(req.body.change_ids)
    ? req.body.change_ids
    : []
  if (changeIds.length === 0) {
    return res.status(400).json({ message: 'change_ids is required' })
  }
  await DocumentUpdaterHandler.promises.acceptChanges(
    projectId,
    docId,
    changeIds,
    userId(req)
  )
  await EditorRealTimeController.emitToRoom(
    projectId,
    'accept-changes',
    docId,
    changeIds
  )
  res.sendStatus(204)
}

export default {
  getThreads: expressify(getThreads),
  getProjectRanges: expressify(getProjectRanges),
  sendComment: expressify(sendComment),
  resolveThread: expressify(resolveThread),
  reopenThread: expressify(reopenThread),
  deleteThread: expressify(deleteThread),
  editMessage: expressify(editMessage),
  deleteMessage: expressify(deleteMessage),
  deleteOwnMessage: expressify(deleteOwnMessage),
  acceptChanges: expressify(acceptChanges),
}
