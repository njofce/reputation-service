import { ContractName } from "src/config"
import { ITokenDocument, TokenStatus } from "src/models/tokens/Token.types"
import { zeroAddress } from "src/utils/crypto/constants"
import getContractAddress from "src/utils/crypto/getContractAddress"
import getContractEvents from "src/utils/crypto/getContractEvents"
import getContractInstance from "src/utils/crypto/getContractInstance"
import isTransactionConfirmed from "src/utils/crypto/isTransactionConfirmed"
import stringToBigNumber from "src/utils/crypto/stringToBigNumber"
import logger from "src/utils/server/logger"

export default async function checkAndUpdateTokenStatus(tokens: ITokenDocument[]): Promise<any | null> {
    if (!tokens) return null

    try {
        return await Promise.all(
            tokens.map(async (token) => {
                const tokenId = token.decimalId

                if (!tokenId) {
                    logger.error(`Token with id ${token.id} has no decimalId`)
                    throw new Error(`Token with id ${token.id} has no decimalId`)
                }

                const contractAddress = getContractAddress(ContractName.REPUTATION_BADGE, token.web2Provider)
                const contractInstance = await getContractInstance(ContractName.REPUTATION_BADGE, contractAddress)

                // TODO: checking each contract might not be the most scalable solution
                // refactor to avoid explicit dependency with individual contracts?
                // TODO: Also it should check the right contract based on token.chainId
                const tokenExistsOnChain = await contractInstance.exists(stringToBigNumber(tokenId))

                // console.log(`Token ${tokenId} exists On Chain: ${tokenExistsOnChain}`);
                if (tokenExistsOnChain) {
                    if (token.status === TokenStatus.MINT_PENDING || token.status === TokenStatus.NOT_MINTED) {
                        token.status = TokenStatus.MINTED
                        await token.save()

                        return null
                    }
                } else {
                    if (token.status === TokenStatus.NOT_MINTED || token.status === TokenStatus.REVOKED) {
                        return null
                    }

                    if (token.status === TokenStatus.MINT_PENDING) {
                        if (!token.mintTransactions) {
                            logger.error(`Token status is MINT_PENDING but no mint tx was found. Token id: ${tokenId}`)
                            throw new Error("Error updating token status")
                        }
                        // if at least one minting tx is not confirmed, the status is still pending
                        const promises = token.mintTransactions.map((tx) => isTransactionConfirmed(tx.response.hash))
                        const results = await Promise.all(promises)
                        const pendingTransactionIndex = results.findIndex((isTxConfirmed) => isTxConfirmed === false)
                        if (pendingTransactionIndex !== -1) return null

                        token.status = TokenStatus.NOT_MINTED
                        await token.save()
                    } else {
                        const burnedEvents = await getContractEvents(contractInstance, "Transfer", [
                            undefined,
                            zeroAddress,
                            stringToBigNumber(tokenId)
                        ])

                        if (burnedEvents.length > 0) {
                            token.status = TokenStatus.BURNED
                            await token.save()
                        } else {
                            logger.error(`Token does not exist but no burned event was found. Token id: ${tokenId}`)
                            throw new Error("Error updating token status")
                        }
                    }
                }

                return null
            })
        )
    } catch (err) {
        throw new Error(`Error while updating tokens: ${err}`)
    }
}
