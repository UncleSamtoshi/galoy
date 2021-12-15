import {
  assetsMainAccount,
  bankOwnerAccountPath,
  bitcoindAccountingPath,
  escrowAccountingPath,
  liabilitiesMainAccount,
  lndAccountingPath,
} from "./accounts"
import { MainBook } from "./books"
import { Transaction } from "./schema"

export const getAllAccounts = () => {
  return MainBook.listAccounts()
}

const getAccountBalance = async (account: string, query = {}) => {
  const params = { account, currency: "BTC", ...query }
  const { balance } = await MainBook.balance(params)
  return balance
}

export async function* getAccountsWithPendingTransactions(query = {}) {
  const transactions = Transaction.aggregate([
    { $match: { "pending": true, "account_path.0": liabilitiesMainAccount, ...query } },
    { $group: { _id: "$accounts" } },
  ])
    .cursor({ batchSize: 100 })
    .exec()

  for await (const { _id } of transactions) {
    yield _id
  }
}

export const getAssetsBalance = (currency = "BTC") =>
  getAccountBalance(assetsMainAccount, { currency })

export const getLiabilitiesBalance = (currency = "BTC") =>
  getAccountBalance(liabilitiesMainAccount, { currency })

export const getLndBalance = () => getAccountBalance(lndAccountingPath)

export const getLndEscrowBalance = () => getAccountBalance(escrowAccountingPath)

export const getBitcoindBalance = () => getAccountBalance(bitcoindAccountingPath)

export const getBankOwnerBalance = async (currency = "BTC") => {
  const bankOwnerPath = await bankOwnerAccountPath()
  return getAccountBalance(bankOwnerPath, { currency })
}
