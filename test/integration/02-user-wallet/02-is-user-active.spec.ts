import { getActiveUser } from "@app/users/active-users"
import { User } from "@services/mongoose/schema"
import { getAndCreateUserWallet } from "test/helpers"

describe("getActiveUser", () => {
  it("returns active users according to volume", async () => {
    await getAndCreateUserWallet(0)

    let spy = jest
      .spyOn(User, "getVolume")
      .mockImplementation(() => ({ outgoingSats: 50000, incomingSats: 100000 }))

    const activeUsers = await getActiveUser()
    if (activeUsers instanceof Error) throw activeUsers
    spy.mockClear()

    const accountIds = activeUsers.map((user) => user.id)
    const userWallet0AccountId = (await getAndCreateUserWallet(0)).user.id
    const funderWalletAccountId = (await User.findOne({ role: "funder" })).id

    // userWallets used in the tests
    // TODO: test could be optimized. instead of fetching all the users, we could verify
    // getActiveUser is only apply to some of them
    expect(accountIds).toEqual(
      expect.arrayContaining([userWallet0AccountId, funderWalletAccountId]),
    )

    spy = jest
      .spyOn(User, "getVolume")
      .mockImplementation(() => ({ outgoingSats: 0, incomingSats: 0 }))

    const finalActiveUsers = await getActiveUser()
    if (finalActiveUsers instanceof Error) throw finalActiveUsers

    const finalNumActiveUsers = finalActiveUsers.length
    spy.mockClear()

    expect(finalNumActiveUsers).toBe(0)
  })
})
