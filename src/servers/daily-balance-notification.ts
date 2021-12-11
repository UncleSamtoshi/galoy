import { getActiveUser } from "@app/users/active-users"
import { WalletFactory } from "@core/wallet-factory"
import { baseLogger } from "@services/logger"
import { setupMongoConnection } from "@services/mongodb"

const logger = baseLogger.child({ module: "dailyBalanceNotification" })

const main = async () => {
  const mongoose = await setupMongoConnection()
  await sendBalanceToUsers()

  await mongoose.connection.close()
  // FIXME: we need to exit because we may have some pending promise
  process.exit(0)
}

export const sendBalanceToUsers = async () => {
  const users = await getActiveUser()
  if (users instanceof Error) throw users

  for (const user of users) {
    const userWallet = await WalletFactory({ user, logger })
    await userWallet.sendBalance()
  }
}

if (require.main === module) {
  try {
    main()
  } catch (err) {
    baseLogger.warn({ err }, "error in the dailyBalanceNotification job")
  }
}
