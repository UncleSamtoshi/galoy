import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { transactions_template } from "./const"
import { sign, verify } from "./crypto"
import * as moment from 'moment'
import { IQuoteResponse, IQuoteRequest, IBuyRequest, OnboardingRewards } from "../../../../common/types"
import { getFiatBalance } from "./fiat"
import { channelsWithPubkey, uidToPubkey, pubkeyToUid } from "./utils"
import { priceBTC } from "./exchange"
const validate = require("validate.js")
const lnService = require('ln-service')

interface Auth {
    macaroon: string,
    cert: string,
    socket: string,
}

interface FiatTransaction {
    amount: number, 
    date: number,
    icon: string,
    name: string,
    onchain_tx?: string, // should be HEX?
}


// we are extending validate so that we can validate dates
// which are not supported date by default
validate.extend(validate.validators.datetime, {
    // The value is guaranteed not to be null or undefined but otherwise it
    // could be anything.
    parse: function(value: any, options: any) {
        return +moment.utc(value);
    },
    // Input is a unix timestamp
    format: function(value: any, options: any) {
        const format = options.dateOnly ? "YYYY-MM-DD" : "YYYY-MM-DD hh:mm:ss";
        return moment.utc(value).format(format);
    }
});


admin.initializeApp();
const firestore = admin.firestore()


const initLnd = () => {
    // TODO verify wallet is unlock?

    let auth_lnd: Auth
    let network: string
    
    try {
        network = process.env.NETWORK ?? functions.config().lnd.network
        const cert = process.env.TLS ?? functions.config().lnd[network].tls
        const macaroon = process.env.MACAROON ?? functions.config().lnd[network].macaroon
        const lndaddr = process.env.LNDADDR ?? functions.config().lnd[network].lndaddr
    
        const socket = `${lndaddr}:10009`
        auth_lnd = {macaroon, cert, socket}
    } catch (err) {
        throw new functions.https.HttpsError('failed-precondition', 
            `neither env nor functions.config() are set` + err)
    }

    // console.log("lnd auth", auth_lnd)
    const {lnd} = lnService.authenticatedLndGrpc(auth_lnd);
    return lnd
}


exports.updatePrice = functions.pubsub.schedule('every 4 hours').onRun(async (context) => {
    try {
        const spot = await priceBTC()
        console.log(`updating price, new price: ${spot}`);
        await firestore.doc('global/price').set({BTC: spot})
    } catch (err) {
        throw new functions.https.HttpsError('internal', err.toString())
    }
});


const checkAuth = (context: any) => { // FIXME any
    if (!context.auth) {
        throw new functions.https.HttpsError('failed-precondition', 
            'The function must be called while authenticated.')
    }
}

const checkNonAnonymous = (context: any) => { // FIXME any
    checkAuth(context)

    if (context.auth.token.provider_id === "anonymous") {
        throw new functions.https.HttpsError('failed-precondition', 
            `This function must be while authenticate and not anonymous`)
    }
}

const checkBankingEnabled = checkNonAnonymous // TODO

// this could be run in the frontend?
exports.getFiatBalances = functions.https.onCall((data, context) => {
    checkBankingEnabled(context)

    return getFiatBalance(context.auth!.uid)
})


exports.sendPubkey = functions.https.onCall(async (data, context) => {
    checkNonAnonymous(context)

    const constraints = {
        pubkey: {
            length: {is: 66} // why 66 and not 64?
        },
        network: {
            inclusion: {
                within: {"testnet": "mainnet"}
        }}
    }

    {
        const err = validate(data, constraints)
        if (err !== undefined) {
            throw new functions.https.HttpsError('invalid-argument', JSON.stringify(err))
        }
    }

    try {
        const writeResult = await firestore.doc(`/users/${context.auth!.uid}`).set({
            lightning: {
                pubkey: data.pubkey,
                network: data.network,
                initTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            }}, { merge: true })
        
        console.log(writeResult)
        return {result: `Transaction succesfully added, uid: ${context.auth!.uid}, pubkey: ${data.pubkey}`}

    } catch (err) {
        console.error(err)
        throw new functions.https.HttpsError('internal', err)
    }
})

exports.sendDeviceToken = functions.https.onCall(async (data, context) => {
    checkAuth(context)

    return firestore.doc(`/users/${context.auth!.uid}`).set({
        deviceToken: data.deviceToken}, { merge: true }
    ).then(writeResult => {
        return {result: `Transaction succesfully added ${writeResult}`}
    })
    .catch((err) => {
        console.error(err)
        throw new functions.https.HttpsError('internal', err)
    })
})

const openChannel = async (lnd: any, pubkey: string, attempt_amount: number = 0) => {
    
    const BACKOFF_LIQUIDITY = [50000, 1000000, 5000000, 16000000]

    const channels = await channelsWithPubkey(lnd, pubkey)
    const capacity = channels.reduce((total, current: any) => total + current['capacity'], 0) as number

    const min_channel = Math.max(capacity, attempt_amount)

    let index = BACKOFF_LIQUIDITY.findIndex(item => item > min_channel)
    if (index === -1) {
        index = BACKOFF_LIQUIDITY.length - 1
    }

    const local_tokens = BACKOFF_LIQUIDITY[index]

    console.log({capacity, min_channel, local_tokens})

    const is_private = true
    const min_confirmations = 0 // to allow unconfirmed UTXOS
    const chain_fee_tokens_per_vbyte = 1
    const input: any = {lnd, local_tokens, partner_public_key: pubkey, is_private, min_confirmations, chain_fee_tokens_per_vbyte}

    console.log('trying to open a channel with:', input)

    try {
        return await lnService.openChannel(input)
    } catch (err) {
        throw new functions.https.HttpsError('internal', `can't open channel, error: ${err[0]} ${err[1]} ${err[2] ? JSON.stringify(err[2], null, 4): ""}`)
    }
}

exports.openFirstChannel = functions.https.onCall(async (data, context) => {
    checkNonAnonymous(context) // move to decorator @checkanonymous

    const lnd = initLnd()
    const pubkey = await uidToPubkey(context.auth!.uid)

    const channels = await channelsWithPubkey(lnd, pubkey)

    if (channels.length > 1) {
        console.log(`not the first channel for ${pubkey}, not sending a text`)
        return {response: 'first-channel-already-opened'}
    }

    try {
        console.log(`openFirstChannel with pubkey ${pubkey}`)
        const funding_tx = await openChannel(lnd, pubkey)
        return {funding_tx}
    } catch (err) {
        console.error(err)
        let message = `${err[0]}, ${err[1]}, `
        message += err[2] ? err[2].details : '' // FIXME verify details it the property we want
        throw new functions.https.HttpsError('internal', message)
    }
})

exports.quoteLNDBTC = functions.https.onCall(async (data: IQuoteRequest, context) => {
    checkBankingEnabled(context)

    const SPREAD = 0.015 //1.5%
    const QUOTE_VALIDITY = {seconds: 30}

    const constraints = {
        // side is from the customer side.
        // eg: buy side means customer is buying, we are selling.
        side: {
            inclusion: ["buy", "sell"]
        },
        invoice: function(value: any, attributes: any) {
            if (attributes.side === "sell") return null;
            return {
              presence: {message: "is required for buy order"},
              length: {minimum: 6} // what should be the minimum invoice length?
            };
        }, // we can derive satAmount for sell order with the invoice
        satAmount: function(value: any, attributes: any) {
            if (attributes.side === "buy") return null;
            return {
                presence: {message: "is required for sell order"},
                numericality: {
                    onlyInteger: true,
                    greaterThan: 0
            }}
    }}

    const err = validate(data, constraints)
    if (err !== undefined) {
        throw new functions.https.HttpsError('invalid-argument', JSON.stringify(err))
    }
    
    console.log(`${data.side} quote request from ${context.auth!.uid}, request: ${JSON.stringify(data, null, 4)}`)

    let spot
    
    try {
        spot = await priceBTC()
    } catch (err) {
        throw new functions.https.HttpsError('unavailable', err)
    }

    const satAmount = data.satAmount

    let multiplier = NaN

    if (data.side === "buy") {
        multiplier = 1 + SPREAD
    } else if (data.side === "sell") {
        multiplier = 1 - SPREAD
    }

    const side = data.side
    const satPrice = multiplier * spot
    const validUntil = moment().add(QUOTE_VALIDITY)

    const lnd = initLnd()

    const description = {
        satPrice,
        memo: "Sell BTC"
    }

    if (data.side === "sell") {
        const {request} = await lnService.createInvoice(
            {lnd, 
            tokens: satAmount,
            description: JSON.stringify(description),
            expires_at: validUntil.toISOString(),
        });

        if (request === undefined) {
            throw new functions.https.HttpsError('unavailable', 'error creating invoice')
        }

        return {side, invoice: request} as IQuoteResponse
        
    } else if (data.side === "buy") {

        const invoiceJson = await lnService.decodePaymentRequest({lnd, request: data.invoice})

        if (moment.utc() < moment.utc(invoiceJson.expires_at).subtract(QUOTE_VALIDITY)) { 
            throw new functions.https.HttpsError('failed-precondition', 'invoice expire within 30 seconds')
        }

        if (moment.utc() > moment.utc(invoiceJson.expires_at)) {
            throw new functions.https.HttpsError('failed-precondition', 'invoice already expired')
        }

        const message: IQuoteResponse = {
            side, 
            satPrice, 
            invoice: data.invoice!,
        }

        const signedMessage = await sign({... message})

        console.log(signedMessage)
        return signedMessage
    }

    return {'result': 'success'}
})


exports.buyLNDBTC = functions.https.onCall(async (data: IBuyRequest, context) => {
    checkBankingEnabled(context)

    const constraints = {
        side: {
            inclusion: ["buy"]
        },
        invoice: {
            presence: true,
            length: {minimum: 6} // what should be the minimum invoice length?
        },
        satPrice: {
            presence: true,
            numericality: {
                greaterThan: 0
        }},
        signature: {
            presence: true,
            length: {minimum: 6} // FIXME set correct signature length
        }
    }

    const err = validate(data, constraints)
    if (err !== undefined) {
        throw new functions.https.HttpsError('invalid-argument', JSON.stringify(err))
    }

    if (!verify(data)) {
        throw new functions.https.HttpsError('failed-precondition', 'signature is not valid')
    }

    const lnd = initLnd()
    const invoiceJson = await lnService.decodePaymentRequest({lnd, request: data.invoice})

    const satAmount = invoiceJson.tokens
    const destination = invoiceJson.destination

    const fiatAmount = satAmount * data.satPrice

    if (await getFiatBalance(context.auth!.uid) < fiatAmount) {
        throw new functions.https.HttpsError('permission-denied', 'not enough dollar to proceed')
    }

    const {route} = await lnService.probeForRoute({lnd, tokens: satAmount, destination})
    
    if (route?.length === 0) {
        throw new functions.https.HttpsError('internal', `Can't probe payment. Not enough liquidity?`)
    }

    const request = {lnd, ...invoiceJson}
    console.log({request})

    try {
        await lnService.payViaPaymentDetails(request) // TODO move to pay to unified payment to our light client
    } catch (err) {
        console.error(err)
        throw new functions.https.HttpsError('internal', `Error paying invoice ${err[0]}, ${err[1]}, ${err[2]?.details}`)
    }

    const fiat_tx: FiatTransaction = {
        amount: - fiatAmount, 
        date: moment().unix(),
        icon: "logo-bitcoin",
        name: "Bought Bitcoin",
        // onchain_tx: onchain_tx.id
    }

    try {
        const result = await firestore.doc(`/users/${context.auth!.uid}`).update({
            transactions: admin.firestore.FieldValue.arrayUnion(fiat_tx)
        })

        console.log(result)
    } catch(err) {
        throw new functions.https.HttpsError('internal', 'issue updating transaction on the database')
    }

    console.log("success")
    return {success: "success"}
})

// sellBTC
exports.incomingInvoice = functions.https.onRequest(async (req, res) => {
    // TODO only authorize by admin-like
    // should just validate previous transaction

    const lnd = initLnd()

    const invoice = req.body
    console.log(invoice)

    const request = invoice.request
    const channel = invoice.payments[0].in_channel // should it be htlcs[0] now?

    const invoiceJson = await lnService.decodePaymentRequest({lnd, request})

    // get a list of all the channels
    const { channels } = await lnService.getChannels({lnd})
    const channelJson = channels.filter((item: any) => item.id === channel)
    const partner_public_key = channelJson[0].partner_public_key

    const users = firestore.collection("users");
    const querySnapshot = await users.where("lightning.pubkey", "==", partner_public_key).get();
    const uid = (querySnapshot.docs[0].ref as any)._path.segments[1] // FIXME use path?

    const satAmount = invoiceJson.tokens
    const satPrice = parseFloat(JSON.parse(invoiceJson.description)['satPrice'])
    const fiatAmount = satAmount * satPrice

    const fiat_tx: FiatTransaction = {
        amount: fiatAmount,
        date: Date.parse(invoiceJson.expires_at) / 1000,
        icon: "logo-bitcoin",
        name: "Sold Bitcoin",
    }

    await firestore.doc(`/users/${uid}`).update({
        transactions: admin.firestore.FieldValue.arrayUnion(fiat_tx)
    })

    return res.status(200).send({response: `invoice ${request} accounted succesfully`});

})

interface IPaymentRequest {
    pubkey?: string;
    amount?: number;
    message?: string;
    // or:
    invoice?: string
}

const pay = async (obj: IPaymentRequest) => {
    const {pubkey, amount, message} = obj

    if (pubkey === undefined) {
        throw new functions.https.HttpsError('internal', `pubkey ${pubkey} in pay function`)
    }

    const {randomBytes, createHash} = require('crypto')
    const preimageByteLength = 32
    const preimage = randomBytes(preimageByteLength);
    const secret = preimage.toString('hex');
    const keySendPreimageType = '5482373484'; // key to use representing 'amount'
    const messageTmpId = '123123'; // random number, internal to Galoy for now

    const id = createHash('sha256').update(preimage).digest().toString('hex');
    const lnd = initLnd()

    const messages = [
        {type: keySendPreimageType, value: secret},
    ]

    if (message) {
        messages.push({
            type: messageTmpId, 
            value: Buffer.from(message).toString('hex'),
        })
    }

    const request = {
        id,
        destination: pubkey,
        lnd,
        messages,
        tokens: amount,
    }

    let result
    try {
        result = await lnService.payViaPaymentDetails(request)
    } catch (err) {
        if (err[1] === 'FailedToFindPayableRouteToDestination') {
            // TODO: understand what trigger this error more specifically
    
            console.log(`no liquidity with pubkey ${pubkey}, opening new channel`)
            await openChannel(lnd, pubkey, amount);
        }
    }

    console.log(result)
}


const giveRewards = async (uid: string, _stage: string[] | undefined = undefined) => {

    const stage = _stage || (await firestore.doc(`users/${uid}/collection/stage`).get()).data()!.stage
    
    // TODO rely on the invoice instead to know what is paid. need better invoice filtering.
    const paid: string[] | undefined = (await firestore.doc(`users/${uid}/collection/paid`).get())?.data()?.stage as string[]
    console.log('paid', paid)

    // TODO move to loadash to clean this up. 
    const toPay = stage?.filter((x:string) => !new Set(paid).has(x))
    console.log('toPay', toPay)

    const pubkey = await uidToPubkey(uid)

    for (const item of toPay) {
        const amount: number = (<any>OnboardingRewards)[item]
        console.log(`trying to pay ${item} for ${amount}`)

        try {
            await pay({pubkey, amount, message: item})
        } catch (err) {
            throw new functions.https.HttpsError('internal', err.toString())
        }

        console.log(`paid rewards ${item} to ${uid}`)

        await firestore.doc(`/users/${uid}/collection/paid`).set({
            stage: admin.firestore.FieldValue.arrayUnion(item)
        }, { 
            merge: true
        })

        console.log(`payment for ${item} stored in db`)
    }
}

exports.onStageUpdated = functions.firestore
    .document('users/{uid}/collection/stage')
    .onWrite(async (change, context) => {

        try {
            const uid = context.params.uid
            const { stage } = change.after.data() as any // FIXME type
            console.log('stage', stage)
            
            await giveRewards(uid, stage)

        } catch (err) {
            console.error(err)
        }
});


exports.requestRewards = functions.https.onCall(async (data, context) => {
    checkNonAnonymous(context)

    await giveRewards(context.auth!.uid)

    return {'result': 'success'}
})

exports.dollarFaucet = functions.https.onCall(async (data, context) => {
    checkBankingEnabled(context)

    const fiat_tx: FiatTransaction = {
        amount: data.amount,
        date: moment().unix(),
        icon: "ios-print",
        name: "Dollar Faucet",
    }

    await firestore.doc(`/users/${context.auth!.uid}`).update({
        transactions: admin.firestore.FieldValue.arrayUnion(fiat_tx)
    })
})

exports.onBankAccountOpening = functions.https.onCall(async (data, context) => {
    checkNonAnonymous(context)

    const constraints = {
        dateOfBirth: {
            datetime: true,
            // latest: moment.utc().subtract(18, 'years'),
            // message: "^You need to be at least 18 years old"
        },
        firstName: {
            presence: true, 
        },
        lastName: {
            presence: true, 
        },
        email: {
            email: true
        },
    }

    {
        const err = validate(data, constraints)
        if (err !== undefined) {
            console.log(err)
            throw new functions.https.HttpsError('invalid-argument', JSON.stringify(err))
        }
    }

    return firestore.doc(`/users/${context.auth!.uid}`).set({ userInfo: data }, { merge: true }
    ).then(writeResult => {
        return {result: `Transaction succesfully added ${writeResult}`}
    })
    .catch((err) => {
        console.error(err)
        throw new functions.https.HttpsError('internal', err.toString())
    })

})


// TODO use onCall instead
exports.incomingOnChainTransaction = functions.https.onRequest(async (req, res) => {
    // TODO only authorize by admin-like
    // should just validate previous transaction

    // TODO: better UX can be done by taking consideration
    // for incoming transaction not yet mined, showing as "pending"

    const tx = req.body
    console.log(tx)

    return {'result': 'success'}
});

/**
 * This function is used to send a text message after the first channel is being opened
 */
exports.incomingChannel = functions.https.onRequest(async (req, res) => {
    const { sendText } = require("./text")

    // TODO use onCall instead
    // TODO only authorize by admin-like
    // should just validate previous transaction

    const channel = req.body
    console.log(channel)

    const lnd = initLnd()

    const channels = await channelsWithPubkey(lnd, channel.partner_public_key)

    const uid = await pubkeyToUid(channel.partner_public_key)
    console.log('uid: ', uid)

    if (channels.length === 1) {
        const phoneNumber = (await admin.auth().getUser(uid)).phoneNumber

        if (phoneNumber === undefined) {
            throw new functions.https.HttpsError('internal', `${phoneNumber} undefined`)
        }
    
        console.log(`sending message to ${phoneNumber} for channel creation`)
        
        try {
            await sendText({
                to: phoneNumber,
                body: `Your wallet is ready! open your galoy://app to get and spend your micro reward`
            })
        } catch (err) {
            console.error(`impossible to send twilio request`, err)
            throw new functions.https.HttpsError('internal', `impossible to send twilio request ${err}`)
        }            
    }

    try {
        await giveRewards(uid)
    } catch (err) {
        throw new functions.https.HttpsError('internal', `can't give the rewards ${err}`)
    }

    return res.status(200).send({response: 'ok'})
})


exports.onUserCreation = functions.auth.user().onCreate(async (user) => {
    //TODO clean up returns

    const prepopulate = false
    const lookup = false

    let transactions: any[] // FIXME

    if (prepopulate) {
        transactions = transactions_template.filter((item) => Math.random() > 0.5 )
    } else {
        transactions = []
    }

    try {
        const result = await firestore.doc(`/users/${user.uid}`).set(
            { transactions },
            { merge: true }
        )
        console.log(`Transaction succesfully added ${result}`)
    } catch (err) {
        console.error(err)
        throw new functions.https.HttpsError('internal', err)
    }

    if (lookup) {

        const { getTwilioClient } = require("./text")

        const phoneNumber = (await admin.auth().getUser(user.uid)).phoneNumber
        console.log(phoneNumber)

        const callerInfo = await getTwilioClient().lookups.phoneNumbers(phoneNumber)
                                .fetch({type: ['caller-name', 'carrier']})

        const twilio = JSON.parse(JSON.stringify(callerInfo)) // FIXME hacky?

        return firestore.doc(`/users/${user.uid}`).set({ twilio }, { merge: true }
        ).then(writeResult => {
            return {result: `Transaction succesfully added ${writeResult}`}
        })
        .catch((err) => {
            console.error(err)
            throw new functions.https.HttpsError('internal', err)
        })
    }

    return {'result': 'success'}
})

exports.test = functions.https.onCall(async (data, context) => {
    console.log(context)
})

exports.setGlobalInfo = functions.https.onCall(async (data, context) => {
    const lnd = initLnd()
    const wallet = await lnService.getWalletInfo({lnd});

    return firestore.doc(`/global/info`).set({
        lightning: {
            pubkey: wallet.public_key,
            host: functions.config().lnd[functions.config().lnd.network].lndaddr
    }})
})

exports.deleteCurrentUser = functions.https.onCall(async (data, context) => {
    try {
        await admin.auth().deleteUser(context.auth!.uid)
        return {'result': 'success'}
    } catch(err) {
        throw new functions.https.HttpsError('internal', err)
    }
})

exports.deleteAllUsers = functions.https.onCall(async (data, context) => {
    return admin.auth().listUsers()
    .then(listUsers => {
        for (const user of listUsers.users) {
            admin.auth().deleteUser(user.uid)
            .catch(err => err)
        }

        const collectionDeleted = deleteCollection(firestore, 'users', 50)
        
        return {userDeleted: listUsers.users, collectionDeleted}
    })
    .catch(err => {
        throw new functions.https.HttpsError('internal', err)
    })
})

const deleteCollection = async (db: any, collectionPath: any, batchSize: any) => {
    let collectionRef = db.collection(collectionPath);
    let query = collectionRef.orderBy('__name__').limit(batchSize);
  
    return new Promise((resolve, reject) => {
      deleteQueryBatch(db, query, batchSize, resolve, reject);
    });
  }
  
function deleteQueryBatch(db: any, query: any, batchSize: any, resolve: any, reject: any) {
    query.get()
    .then((snapshot: any) => {
    // When there are no documents left, we are done
    if (snapshot.size == 0) {
        return 0;
    }

    // Delete documents in a batch
    let batch = db.batch();
    snapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
    });

    return batch.commit().then(() => {
        return snapshot.size;
    });
    }).then((numDeleted: any) => {
    if (numDeleted === 0) {
        resolve();
        return;
    }

    // Recurse on the next process tick, to avoid
    // exploding the stack.
    process.nextTick(() => {
        deleteQueryBatch(db, query, batchSize, resolve, reject);
    });
    })
    .catch(reject);
}
