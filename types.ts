import { z } from 'zod'

// /getCollateral
export const RequestGetCollateral = z.object({
  id: z.number().or(z.undefined()),
})

export type RequestGetCollateral = z.infer<typeof RequestGetCollateral>

export const ResponseGetCollateral = z.object({
  collateral: z.object({
    transaction_id: z.string(),
    index: z.number(),
  }),
})

export type ResponseGetCollateral = z.infer<typeof ResponseGetCollateral>

// /signCollateral
export const RequestSignCollateral = z.object({
  txCbor: z.string(),
  additionalUTxOs: z.array(z.string())
})

export type RequestSignCollateral = z.infer<typeof RequestSignCollateral>

export type ResponseSignCollateral = {
  witnessesCbor: string
}
