import { toSats } from "@domain/bitcoin"
import { LedgerTransactionType } from "@domain/ledger"
import { MEMO_SHARING_SATS_THRESHOLD } from "@config/app"
import { SettlementMethod } from "./settlement-method"

const addPendingIncoming = (
  confirmedTransactions: WalletTransaction[],
  pendingTransactions: SubmittedTransaction[],
  addresses: OnChainAddress[],
): WalletTransactionHistoryWithPending => {
  const walletTransactions: WalletTransaction[] = []
  pendingTransactions.forEach(({ id, rawTx, createdAt }) => {
    rawTx.outs.forEach(({ sats, address }) => {
      if (addresses.includes(address)) {
        walletTransactions.push({
          id,
          settlementVia: SettlementMethod.OnChain,
          description: "pending",
          settlementFee: toSats(0),
          pendingConfirmation: true,
          createdAt: createdAt,
          settlementAmount: sats,
          addresses: [address],
        })
      }
    })
  })
  return {
    transactions: [...walletTransactions, ...confirmedTransactions],
  }
}

export const confirmed = (
  ledgerTransactions: LedgerTransaction[],
): ConfirmedTransactionHistory => {
  const transactions = ledgerTransactions.map(
    ({
      id,
      memoFromPayer,
      lnMemo,
      type,
      credit,
      debit,
      fee,
      paymentHash,
      username,
      addresses,
      pendingConfirmation,
      timestamp,
    }) => {
      const settlementAmount = toSats(credit - debit)
      const description = translateDescription({
        type,
        memoFromPayer,
        lnMemo,
        credit,
        username,
      })
      if (
        type == LedgerTransactionType.IntraLedger ||
        type == LedgerTransactionType.OnchainIntraLedger
      ) {
        return {
          id,
          settlementVia: SettlementMethod.IntraLedger,
          description,
          settlementAmount,
          settlementFee: fee,
          paymentHash: paymentHash as PaymentHash,
          recipientId: username || null,
          pendingConfirmation,
          createdAt: timestamp,
        }
      } else if (addresses && addresses.length > 0) {
        return {
          id,
          settlementVia: SettlementMethod.OnChain,
          addresses,
          description,
          settlementAmount,
          settlementFee: fee,
          pendingConfirmation,
          createdAt: timestamp,
        }
      }
      return {
        id,
        settlementVia: SettlementMethod.Lightning,
        description,
        settlementAmount,
        settlementFee: fee,
        paymentHash: paymentHash as PaymentHash,
        username,
        pendingConfirmation,
        createdAt: timestamp,
      }
    },
  )
  return {
    transactions,
    addPendingIncoming: (
      pendingIncoming: SubmittedTransaction[],
      addresses: OnChainAddress[],
    ) => addPendingIncoming(transactions, pendingIncoming, addresses),
  }
}

const shouldDisplayMemo = (credit: number) => {
  return credit == 0 || credit >= MEMO_SHARING_SATS_THRESHOLD
}

export const translateDescription = ({
  memoFromPayer,
  lnMemo,
  username,
  type,
  credit,
}: {
  memoFromPayer?: string
  lnMemo?: string
  username?: string
  type: LedgerTransactionType
  credit: number
}): string => {
  if (shouldDisplayMemo(credit)) {
    if (memoFromPayer) {
      return memoFromPayer
    }
    if (lnMemo) {
      return lnMemo
    }
  }

  let usernameDescription
  if (username) {
    if (credit > 0) {
      usernameDescription = `from ${username}`
    } else {
      usernameDescription = `to ${username}`
    }
  }

  return usernameDescription || type
}

export const WalletTransactionHistory = {
  confirmed,
} as const