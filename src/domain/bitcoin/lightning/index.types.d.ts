type LightningError = import("./errors").LightningError
type LnInvoiceDecodeError = import("./errors").LnInvoiceDecodeError
type LightningServiceError = import("./errors").LightningServiceError
type RouteNotFoundError = import("./errors").RouteNotFoundError

declare const invoiceExpirationSymbol: unique symbol
type InvoiceExpiration = Date & { [invoiceExpirationSymbol]: never }

declare const encodedPaymentRequestSymbol: unique symbol
type EncodedPaymentRequest = string & { [encodedPaymentRequestSymbol]: never }

declare const paymentLedgerIdSymbol: unique symbol
type PaymentLedgerId = string & { [paymentLedgerIdSymbol]: never }

declare const paymentHashSymbol: unique symbol
type PaymentHash = string & { [paymentHashSymbol]: never }

declare const paymentSecretSymbol: unique symbol
type PaymentSecret = string & { [paymentSecretSymbol]: never }

declare const featureBitSymbol: unique symbol
type FeatureBit = number & { [featureBitSymbol]: never }

declare const featureTypeSymbol: unique symbol
type FeatureType = string & { [featureTypeSymbol]: never }

type PaymentStatus =
  typeof import("./index").PaymentStatus[keyof typeof import("./index").PaymentStatus]

type PaymentSendStatus =
  typeof import("./index").PaymentSendStatus[keyof typeof import("./index").PaymentSendStatus]

type Hop = {
  baseFeeMTokens?: string
  channel?: string
  cltvDelta?: number
  feeRate?: number
  nodePubkey: Pubkey
}

type LnInvoiceFeature = {
  // BOLT 09 Feature Bit Number
  bit: FeatureBit
  // Feature Support is Required To Pay Bool
  isRequired: boolean
  // Feature Type String
  type: FeatureType
}

type LnInvoiceLookup = {
  readonly createdAt: Date
  readonly confirmedAt: Date | undefined
  readonly description: string
  readonly expiresAt: Date | undefined
  readonly isSettled: boolean
  readonly received: Satoshis
  readonly paymentRequest: string | undefined
  readonly secret: PaymentSecret
}

type GetPaymentResult = import("lightning").GetPaymentResult
type RawPaths = NonNullable<GetPaymentResult["payment"]>["paths"]

type GetPaymentsResults = import("lightning").GetPaymentsResult
type LnPaymentAttempt = GetPaymentsResults["payments"][number]["attempts"][number]

type LnPaymentDetails = {
  readonly confirmedAt: Date | undefined
  readonly destination: Pubkey
  readonly milliSatsFee: MilliSatoshis | undefined
  readonly milliSatsAmount: MilliSatoshis
  readonly roundedUpFee: Satoshis | undefined
  readonly secret: PaymentSecret | undefined
  readonly amount: Satoshis
}

type LnPaymentLookup = {
  createdAt: Date | undefined
  status: PaymentStatus
  paymentHash: PaymentHash
  paymentRequest: EncodedPaymentRequest | undefined
  paymentDetails: LnPaymentDetails | undefined
  attempts: LnPaymentAttempt[]
}

type LnPayment = LnPaymentLookup & {
  id: PaymentLedgerId
  isCompleteRecord: boolean
}

type LnInvoice = {
  readonly destination: Pubkey
  readonly paymentHash: PaymentHash
  readonly paymentRequest: EncodedPaymentRequest
  readonly milliSatsAmount: MilliSatoshis
  readonly description: string
  readonly cltvDelta: number | null
  readonly amount: Satoshis | null
  readonly routeHints: Hop[][]
  readonly paymentSecret: PaymentSecret | null
  readonly features: LnInvoiceFeature[]
}

type RegisterInvoiceArgs = {
  description: string
  descriptionHash?: string
  satoshis: Satoshis
  expiresAt: InvoiceExpiration
}

type RegisteredInvoice = {
  invoice: LnInvoice
  pubkey: Pubkey
}

type LnFeeCalculator = {
  max(amount: Satoshis): Satoshis
}

type PayInvoiceResult = {
  roundedUpFee: Satoshis
}

interface ILightningService {
  defaultLnd(): AuthenticatedLnd
  isLocal(pubkey: Pubkey): boolean | LightningServiceError

  defaultPubkey(): Pubkey

  findRouteForInvoice({
    decodedInvoice,
    maxFee,
  }: {
    decodedInvoice: LnInvoice
    maxFee: Satoshis
  }): Promise<RawRoute | LightningServiceError>

  findRouteForNoAmountInvoice({
    decodedInvoice,
    maxFee,
    amount,
  }: {
    decodedInvoice: LnInvoice
    maxFee: Satoshis
    amount: Satoshis
  }): Promise<RawRoute | LightningServiceError>

  registerInvoice(
    registerInvoiceArgs: RegisterInvoiceArgs,
  ): Promise<RegisteredInvoice | LightningServiceError>

  lookupInvoice({
    pubkey,
    paymentHash,
  }: {
    pubkey: Pubkey
    paymentHash: PaymentHash
  }): Promise<LnInvoiceLookup | LightningServiceError>

  lookupPayment({
    pubkey,
    paymentHash,
  }: {
    pubkey?: Pubkey
    paymentHash: PaymentHash
  }): Promise<LnPaymentLookup | LightningServiceError>

  cancelInvoice({
    pubkey,
    paymentHash,
  }: {
    pubkey: Pubkey
    paymentHash: PaymentHash
  }): Promise<void | LightningServiceError>

  payInvoiceViaRoutes({
    paymentHash,
    rawRoute,
    pubkey,
  }: {
    paymentHash: PaymentHash
    rawRoute: RawRoute | null
    pubkey: Pubkey | null
  }): Promise<PayInvoiceResult | LightningServiceError>

  payInvoiceViaPaymentDetails({
    decodedInvoice,
    milliSatsAmount,
    maxFee,
  }: {
    decodedInvoice: LnInvoice
    milliSatsAmount: MilliSatoshis
    maxFee: Satoshis
  }): Promise<PayInvoiceResult | LightningServiceError>
}
