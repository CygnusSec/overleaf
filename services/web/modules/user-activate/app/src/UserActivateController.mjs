import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import UserUpdater from '../../../../app/src/Features/User/UserUpdater.mjs'
import UserDeleter from '../../../../app/src/Features/User/UserDeleter.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import EmailHelper from '../../../../app/src/Features/Helpers/EmailHelper.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import { expressify } from '@overleaf/promise-utils'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

function registerNewUser(req, res, next) {
  res.render(Path.resolve(__dirname, '../views/user/register'))
}

async function register(req, res, next) {
  const { email } = req.body
  if (email == null || email === '') {
    return res.sendStatus(422) // Unprocessable Entity
  }
  const { user, setNewPasswordUrl } =
    await UserRegistrationHandler.promises.registerNewUserAndSendActivationEmail(
      email
    )
  res.json({
    email: user.email,
    setNewPasswordUrl,
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function currentUserId(req) {
  return SessionManager.getLoggedInUserId(req.session)?.toString()
}

async function ensureManageableUser(req, res) {
  if (!/^[a-f\d]{24}$/i.test(req.params.userId)) {
    res.sendStatus(404)
    return null
  }
  const user = await User.findById(req.params.userId, {
    email: 1,
    isAdmin: 1,
    adminRoles: 1,
  }).exec()
  if (!user) {
    res.sendStatus(404)
    return null
  }
  if (
    user.isAdmin ||
    user.adminRoles?.length ||
    user._id.toString() === currentUserId(req)
  ) {
    res.status(403).json({ message: 'Admin accounts cannot be modified here.' })
    return null
  }
  return user
}

async function listUsers(req, res) {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
  const limit = Math.min(
    Math.max(Number.parseInt(req.query.limit, 10) || 25, 1),
    100
  )
  const search =
    typeof req.query.search === 'string' ? req.query.search.trim() : ''
  const filter = search
    ? {
        $or: [
          { email: { $regex: escapeRegExp(search), $options: 'i' } },
          { first_name: { $regex: escapeRegExp(search), $options: 'i' } },
          { last_name: { $regex: escapeRegExp(search), $options: 'i' } },
        ],
      }
    : {}

  const [users, filteredTotal, total, active, suspended] = await Promise.all([
    User.find(filter, {
      email: 1,
      first_name: 1,
      last_name: 1,
      isAdmin: 1,
      adminRoles: 1,
      suspended: 1,
      signUpDate: 1,
      lastLoggedIn: 1,
    })
      .sort({ signUpDate: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec(),
    User.countDocuments(filter).exec(),
    User.countDocuments({}).exec(),
    User.countDocuments({ suspended: { $ne: true } }).exec(),
    User.countDocuments({ suspended: true }).exec(),
  ])

  const loggedInUserId = currentUserId(req)
  res.json({
    users: users.map(user => ({
      id: user._id.toString(),
      email: user.email,
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      isAdmin: Boolean(user.isAdmin || user.adminRoles?.length),
      suspended: Boolean(user.suspended),
      signUpDate: user.signUpDate,
      lastLoggedIn: user.lastLoggedIn,
      canManage:
        !user.isAdmin &&
        !user.adminRoles?.length &&
        user._id.toString() !== loggedInUserId,
    })),
    pagination: {
      page,
      limit,
      total: filteredTotal,
      pages: Math.max(Math.ceil(filteredTotal / limit), 1),
    },
    stats: { total, active, suspended },
  })
}

async function updateManagedUser(req, res) {
  const user = await ensureManageableUser(req, res)
  if (!user) return

  const firstName =
    typeof req.body.firstName === 'string' ? req.body.firstName.trim() : ''
  const lastName =
    typeof req.body.lastName === 'string' ? req.body.lastName.trim() : ''
  const email = EmailHelper.parseEmail(req.body.email)
  if (!email || firstName.length > 255 || lastName.length > 255) {
    return res.sendStatus(422)
  }

  const duplicate = await User.exists({
    _id: { $ne: user._id },
    $or: [{ email }, { 'emails.email': email }],
  })
  if (duplicate) {
    return res.status(409).json({ message: 'Email address is already in use.' })
  }

  const auditLog = {
    initiatorId: currentUserId(req),
    ip: req.ip,
    ipAddress: req.ip,
  }
  if (user.email !== email) {
    await UserUpdater.promises.changeEmailAddress(user._id, email, auditLog)
  }
  await UserUpdater.promises.updateUser(user._id, {
    $set: { first_name: firstName, last_name: lastName },
  })
  res.sendStatus(204)
}

async function setUserSuspended(req, res) {
  const user = await ensureManageableUser(req, res)
  if (!user) return
  const suspended = req.body.suspended
  if (typeof suspended !== 'boolean') {
    return res.sendStatus(422)
  }

  if (suspended) {
    await UserUpdater.promises.suspendUser(user._id, {
      initiatorId: currentUserId(req),
      ip: req.ip,
      info: { source: 'admin-user-management' },
    })
  } else {
    await UserUpdater.promises.updateUser(user._id, {
      $set: { suspended: false },
    })
  }
  res.sendStatus(204)
}

async function deleteManagedUser(req, res) {
  const user = await ensureManageableUser(req, res)
  if (!user) return
  await UserDeleter.promises.deleteUser(user._id, {
    deleterUser: { _id: currentUserId(req) },
    ipAddress: req.ip,
    force: true,
    skipEmail: true,
  })
  res.sendStatus(204)
}

async function activateAccountPage(req, res, next) {
  // An 'activation' is actually just a password reset on an account that
  // was set with a random password originally.
  if (req.query.user_id == null || req.query.token == null) {
    return ErrorController.notFound(req, res)
  }

  if (typeof req.query.user_id !== 'string') {
    return ErrorController.forbidden(req, res)
  }

  const user = await UserGetter.promises.getUser(req.query.user_id, {
    email: 1,
    loginCount: 1,
  })

  if (!user) {
    return ErrorController.notFound(req, res)
  }

  if (user.loginCount > 0) {
    // Already seen this user, so account must be activated.
    // This lets users keep clicking the 'activate' link in their email
    // as a way to log in which, if I know our users, they will.
    return res.redirect(`/login`)
  }

  req.session.doLoginAfterPasswordReset = true

  res.render(Path.resolve(__dirname, '../views/user/activate'), {
    title: 'activate_account',
    email: user.email,
    token: req.query.token,
  })
}

export default {
  registerNewUser,
  register: expressify(register),
  listUsers: expressify(listUsers),
  updateManagedUser: expressify(updateManagedUser),
  setUserSuspended: expressify(setUserSuspended),
  deleteManagedUser: expressify(deleteManagedUser),
  activateAccountPage: expressify(activateAccountPage),
}
