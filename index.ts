import { HotWallet, Core, Maestro } from '@blaze-cardano/sdk'
import { TxCBOR } from '@cardano-sdk/core'
import { serve } from 'bun'
import {
  RequestGetCollateral,
  RequestSignCollateral,
  ResponseGetCollateral,
  type ResponseSignCollateral,
} from './types'
import { z } from 'zod'

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
      if (req.method != 'GET') {
        return new Response(JSON.stringify({ error: `Invalid request method: ${req.method}. Only GET is allowed.` }), { status: 400 })
      }
      const request = await req.json()
      const zRequest = RequestGetCollateral.safeParse(request)
      if (!zRequest.success) {
        return new Response(JSON.stringify({ error: 'Unable to parse request for /getCollateral.' }), { status: 400 })
      }
      if (zRequest.data.id) {
        return new Response(JSON.stringify({ error: 'The ID field is not supported in this implementation.' }), { status: 400 })
      }
      const response: ResponseGetCollateral = {
        collateral: {
          transaction_id: collateral_utxo.input().transactionId(),
          index: Number(collateral_utxo.input().index()),
        },
      }
      return new Response(JSON.stringify(response))
    } else if (url.pathname === '/signCollateral') {
      if (req.method != 'POST') {
        return new Response(JSON.stringify({ error: `Invalid request method: ${req.method}. Only POST is allowed.` }), { status: 400 })
      }
      const request = await req.json()
      const zRequest = RequestSignCollateral.safeParse(request)
      if (!zRequest.success) {
        return new Response(JSON.stringify({ error: 'Unable to parse request for /signCollateral.' }), { status: 400 })
      }
      let transaction: Core.Transaction
      try {
        transaction = Core.Transaction.fromCbor(TxCBOR(zRequest.data.txCbor)!)
      } catch {
        return new Response(JSON.stringify({ error: 'Failed to parse transaction CBOR.' }), { status: 400 })
      }
      const additionalUTxOs = zRequest.data.additionalUTxOs.map((x) =>
        Core.TransactionUnspentOutput.fromCbor(Core.HexBlob(x)),
      )
      const additionalInputs = additionalUTxOs.map((x) => x.input())
      // const inputUTxOs = await provider.resolveUnspentOutputs(
      //   [...transaction
      //     .body()
      //     .inputs()
      //     .values()]
      //     //.filter((x) => !additionalInputs.includes(x)),
      // )
      // Todo: check each additional utxo and make sure we aren't spending it

      /*
            todo: validate the transaction, assert no UTxO and/or other action is authorised which should not be
            theoretically we are safe if we just prevent this single utxo (the collateral utxo) being spent,
            as the scheme is the wallet should be funded with a single utxo. However the extra checks are harmless
            in-case the wallet is overfunded
        */
      if (
        transaction
          .body()
          .inputs()
          .values()
          .some((x) => x == collateral_utxo.input())
      ) {
        return new Response(JSON.stringify({ error: 'Collateral input cannot be spent.' }), { status: 400 })
      }
      // if (inputUTxOs.some((x)=>x.output().address().getProps().paymentPart == wallet.address.getProps().paymentPart)){
      //   return new Response(JSON.stringify({ error: 'Inputs owned by the address cannot be spent.' }), { status: 400 })
      // }

      const originalRedeemers = transaction.witnessSet().redeemers()?.values()
      if (!originalRedeemers){
        return new Response(JSON.stringify({ error: "Transaction must include redeemers to provide collateral." }), { status: 400 })
      }
      const evaluatedRedeemers = (await provider.evaluateTransaction(transaction, additionalUTxOs)).values()

      for (let i = 0; i<evaluatedRedeemers.length; i++){
        if (evaluatedRedeemers[i].exUnits().mem() < originalRedeemers[i].exUnits().mem()) {
          return new Response(JSON.stringify({ error: `Collateral evaluation failed: the ${i}th redeemer under-evaluated memory.` }), { status: 400 })
        }
        if (evaluatedRedeemers[i].exUnits().steps() < originalRedeemers[i].exUnits().steps()) {
          return new Response(JSON.stringify({ error: `Collateral evaluation failed: the ${i}th redeemer under-evaluated compute steps.` }), { status: 400 })
        }
      }

      const transactionWitnesses = await wallet.signTransaction(transaction)
      const response: ResponseSignCollateral = {
        witnessesCbor: transactionWitnesses.toCbor(),
      }
      return new Response(JSON.stringify(response))
    }
    return new Response(JSON.stringify({ error: 'Invalid path.' }), { status: 400 })
  },
  port: 80,
})

console.log('Server is running on http://localhost:80')

