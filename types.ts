// /getCollateral
export type ResponseGetCollateral = {
    collateral: {
        transaction_id: string;
        index: number;
    }
}

// /signCollateral
export type ResponseSignCollateral = {
    witnessesCbor: string
}