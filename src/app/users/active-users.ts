import { MS_PER_30_DAYs, USER_ACTIVENESS_MONTHLY_VOLUME_THRESHOLD } from "@config/app"
import { baseLogger } from "@services/logger"
import { User } from "@services/mongoose/schema"

// user is considered active if there has been one transaction of more than 1000 sats in the last 30 days
const isUserActive = async (user: UserType /* FIXME */) => {
  const timestamp30DaysAgo = Date.now() - MS_PER_30_DAYs
  const activenessThreshold = USER_ACTIVENESS_MONTHLY_VOLUME_THRESHOLD

  try {
    // FIXME: remove try/catch, use normal domain pattern
    const volume = await User.getVolume({
      after: timestamp30DaysAgo,
      txnType: [{ type: { $exists: true } }],
      accounts: user.accountPath,
    })

    return (
      volume.outgoingSats > activenessThreshold ||
      volume.incomingSats > activenessThreshold
    )
  } catch (err) {
    baseLogger.warn({ user }, "impossible to get volume of user")
    return false
  }
}

export const getActiveUser = async (): Promise<
  UserType[] /* FIXME */ | ApplicationError
> => {
  const users = await User.find({})
  const activeUsers: Array<UserType> = []
  for (const user of users) {
    // FIXME: this is a very slow query (not critical as only run daily on cron currently).
    // a mongodb query would be able to get the wallet in aggregate directly
    // from medici_transactions instead
    if (await isUserActive(user)) {
      activeUsers.push(user)
    }
  }
  return activeUsers
}
