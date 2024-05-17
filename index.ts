import { HotWallet, Core, Maestro } from '@blaze-cardano/sdk'
import { TxCBOR } from '@cardano-sdk/core'
import { serve } from 'bun'
import type { ResponseGetCollateral, ResponseSignCollateral } from './types'

const NETWORK = Bun.env.NETWORK
if (!NETWORK) {
  throw new Error('The NETWORK environment variable must be set.')
}
let NETWORK_ID = Core.NetworkId.Testnet
if (NETWORK == 'Mainnet') {
  NETWORK_ID = Core.NetworkId.Mainnet
} else if (NETWORK != 'Testnet') {
  throw new Error(`Network ${NETWORK} invalid`)
}
let NETWORK_PROVIDER_NAME = NETWORK?.toLowerCase()
if (!['mainnet', 'preview', 'preprod'].includes(NETWORK.toLowerCase())) {
  throw new Error(`Network ${NETWORK} not supported by provider`)
}
const PRIVATE_KEY_STRING = Bun.env.PRIVATE_KEY
if (!PRIVATE_KEY_STRING) {
  throw new Error('The PRIVATE_KEY environment variable must be set.')
}
const PRIVATE_KEY = Core.Ed25519PrivateNormalKeyHex(PRIVATE_KEY_STRING)
const MAESTRO_KEY = Bun.env.MAESTRO_KEY
if (!MAESTRO_KEY) {
  throw new Error('The MAESTRO_KEY environment variable must be set.')
}

const provider = new Maestro({
  network: NETWORK_PROVIDER_NAME! as 'mainnet' | 'preview' | 'preprod',
  apiKey: MAESTRO_KEY,
})
const wallet = new HotWallet(PRIVATE_KEY, NETWORK_ID, provider)

let utxos: Core.TransactionUnspentOutput[] = await provider.getUnspentOutputs(
  wallet.address,
)
let counter = 0
const collateral_finder = (x: Core.TransactionUnspentOutput) =>
  x.output().amount().coin() >= 5n * 1_000_000n
while (!utxos.some(collateral_finder)) {
  utxos = await provider.getUnspentOutputs(wallet.address)
  console.log(
    `(${counter}): Please deposit a UTxO with exactly 5 ada to the collateral provider address: ${wallet.address.toBech32()}`,
  )
  counter += 1
  await Bun.sleep(10_000)
}
const collateral_utxo = utxos.find(collateral_finder)!

serve({
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/getCollateral') {
      const response: ResponseGetCollateral = {
        collateral: {
          transaction_id: collateral_utxo.input().transactionId(),
          index: Number(collateral_utxo.input().index()),
        },
      }
      return new Response(JSON.stringify(response))
    } else if (url.pathname === '/signCollateral') {
      let txCbor = url.searchParams.get('tx')
      if (!txCbor) {
        throw new Error('Tx must be provided in sign collateral request!')
      }
      let transaction: Core.Transaction
      try {
        transaction = Core.Transaction.fromCbor(TxCBOR(txCbor)!)
      } catch {
        throw new Error('Failed to parse tx cbor into a transaction!')
      }

      /*
            todo: validate the transaction, assert no UTxO and/or other action is authorised which should not be
            theoretically we are safe if we just prevent this single utxo (the collateral utxo) being spent,
            as the scheme is the wallet should be funded with a single utxo. However the extra checks are harmless
            in-case the wallet is overfunded
        */

      const transactionWitnesses = await wallet.signTransaction(transaction)
      const response: ResponseSignCollateral = {
        witnessesCbor: transactionWitnesses.toCbor(),
      }
      return new Response(JSON.stringify(response))
    }
    return new Response('Invalid path')
  },
  port: 80,
})

console.log('Server is running on http://localhost:80')
