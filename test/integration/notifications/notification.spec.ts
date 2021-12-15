import { getCurrentPrice } from "@app/prices"
import { sendBalanceToUsers } from "@servers/daily-balance-notification"
import { LedgerService } from "@services/ledger"
import { User } from "@services/mongoose/schema"

jest.mock("@services/notifications/notification")
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendNotification } = require("@services/notifications/notification")

let price

beforeAll(async () => {
  price = await getCurrentPrice()
  if (price instanceof Error) throw price
  jest
    .spyOn(User, "getVolume")
    .mockImplementation(() => ({ outgoingSats: 1000, incomingSats: 1000 }))
})

afterAll(() => {
  jest.restoreAllMocks()
})

describe("notification", () => {
  describe("sendNotification", () => {
    it("sends daily balance to active users", async () => {
      await sendBalanceToUsers()
      const numActiveUsers = (await User.getActiveUsers()).length
      expect(sendNotification.mock.calls.length).toBe(numActiveUsers)
      for (const [call] of sendNotification.mock.calls) {
        const balance = await LedgerService().getAccountBalance(call.user.id)
        if (balance instanceof Error) throw balance

        const expectedUsdBalance = (price * balance).toLocaleString("en", {
          maximumFractionDigits: 2,
        })
        const expectedSatsBalance = balance.toLocaleString("en", {
          maximumFractionDigits: 2,
        })
        expect(call.title).toBe(
          `Your balance is $${expectedUsdBalance} (${expectedSatsBalance} ${balance} sats)`,
        )
      }
    })
  })
})
