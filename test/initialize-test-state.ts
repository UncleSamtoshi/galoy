import fs from "fs"
import yaml from "js-yaml"
import { Wallets } from "@app"
import { btc2sat } from "@core/utils"
import { BitcoindWalletClient } from "@services/bitcoind"
import {
    bitcoindClient,
    fundLnd,
    createUserWallet,
    lnd1,
    lndOutside1,
    lnd2,
    lndOutside2,
    mineAndConfirm,
    sendToAddressAndConfirm,
    waitUntilSync,
    openChannelTesting,
    setChannelFees
} from "test/helpers"
import { setupMongoConnection } from "@services/mongodb"
import { LightningUserWallet } from "@core/lightning/wallet"

// Load in config
const stateConfigFilePath = process.argv[2] || "./testState.yaml"
const stateConfigFile: string = fs.readFileSync(stateConfigFilePath, "utf8")
const stateConfig = yaml.load(stateConfigFile) as any
const { wallets, test_accounts, transactions, lnd, price } = stateConfig

(async () => {
    await setupMongoConnection()

    // Load up users
    const userWallets : LightningUserWallet[] = await Promise.all(test_accounts.map(account => createUserWallet(account)))

    // Load up wallets
    await Promise.all(wallets.map(async wallet => {
        const { name } = await bitcoindClient.createWallet({ wallet_name: wallet.name })
        const walletClient = new BitcoindWalletClient({ walletName: name })
        const bitcoindAddress = await walletClient.getNewAddress()
        await mineAndConfirm({
            walletClient,
            numOfBlocks: wallet.blocksToMine,
            address: bitcoindAddress,
        })
    }))

    // Load up transactions
    await Promise.all(transactions.map(async transaction => {
        const destinationWallet = userWallets.filter(wallet => wallet.user.phone == transaction.destinationWalletByPhone)[0]
        if (destinationWallet) {
            const destinationAddress = await Wallets.createOnChainAddress(destinationWallet.user.walletId)
            const walletClient = new BitcoindWalletClient({walletName: transaction.walletClientName})
            await sendToAddressAndConfirm({ walletClient, address:destinationAddress, amount:transaction.amount })
        }
    }))
    
    // Fund lnds 
    const lndObject = {lnd1,lnd2,lndOutside1,lndOutside2}
    await Promise.all(lnd.nodes.map(async node => {
        const lndNode = lndObject[node.name]
        await fundLnd(lndNode,btc2sat(node.additonalFundingBTC))
    }))

    // Open channels
    const lndArray = [lnd1,lnd2,lndOutside1,lndOutside2]
    await Promise.all(lnd.channels.map(async channelInfo => {
        await waitUntilSync({ lnds: lndArray })
        const {lndNewChannel} = await openChannelTesting({
            lnd: lndObject[channelInfo.initiatingNode],
            lndPartner: lndObject[channelInfo.partnerNode],
            socket: `${channelInfo.partnerNode}:9735`,
            is_private: channelInfo.private
          })

        await setChannelFees({ lnd: lndObject[channelInfo.initiatingNode], channel:lndNewChannel, base: channelInfo.fees.initiating.base, rate: channelInfo.fees.initiating.rate })
        await setChannelFees({ lnd: lndObject[channelInfo.lndOutside1], channel:lndNewChannel, base: channelInfo.fees.partner.base, rate: channelInfo.fees.partner.rate })
    }))

})()


