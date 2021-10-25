import { Spinner, Text, useToast, VStack } from "@chakra-ui/react"
import { ReputationLevel, Web2Provider } from "@interrep/reputation-criteria"
import semethid from "@interrep/semethid"
import { Signer } from "ethers"
import { useSession } from "next-auth/client"
import { useCallback, useContext, useEffect, useState } from "react"
import Step from "src/components/Step"
import EthereumWalletContext, { EthereumWalletContextType } from "src/context/EthereumWalletContext"
import { Group } from "src/types/groups"
import capitalize from "src/utils/common/capitalize"
import { addIdentityCommitment, checkGroup, checkIdentityCommitment, getGroup } from "src/utils/frontend/api"

export default function Web2Groups(): JSX.Element {
    const [session] = useSession()
    const toast = useToast()
    const { _signer } = useContext(EthereumWalletContext) as EthereumWalletContextType
    const [_identityCommitment, setIdentityCommitment] = useState<string>()
    const [_loading, setLoading] = useState<boolean>(false)
    const [_description, setDescription] = useState<string>()
    const [_group, setGroup] = useState<Group | null>(null)
    const [_currentStep, setCurrentStep] = useState<number>(0)

    const showUnexpectedError = useCallback(() => {
        toast({
            description: "Sorry, there was an unexpected error.",
            variant: "subtle",
            status: "error"
        })

        setLoading(false)
    }, [toast])

    useEffect(() => {
        ;(async () => {
            if (session) {
                setLoading(true)

                const hasJoinedAGroup = await checkGroup()
                const { web2Provider, user } = session

                if (hasJoinedAGroup === null) {
                    showUnexpectedError()
                    return
                }

                if (hasJoinedAGroup) {
                    setDescription(`It seems you already joined a ${capitalize(web2Provider as string)} group.`)
                    setLoading(false)
                    return
                }

                const group = await getGroup({
                    provider: web2Provider,
                    name: user.reputation as ReputationLevel
                })

                if (group === null) {
                    showUnexpectedError()
                    return
                }

                setGroup(group)
                setDescription(
                    `The ${user.reputation} ${capitalize(web2Provider as string)} group has ${
                        group.size
                    } members. Follow the steps below to join it.`
                )
                setCurrentStep(1)
                setLoading(false)
            }
        })()
    }, [session, showUnexpectedError])

    async function retrieveIdentityCommitment(signer: Signer, web2Provider: Web2Provider): Promise<string | null> {
        try {
            return await semethid((message) => signer.signMessage(message), capitalize(web2Provider))
        } catch (error) {
            console.error(error)
            return null
        }
    }

    async function retrieveAndCheckIdentityCommitment(
        signer: Signer,
        group: Group,
        web2Provider: Web2Provider
    ): Promise<void> {
        setLoading(true)

        const identityCommitment = await retrieveIdentityCommitment(signer, web2Provider)

        if (!identityCommitment) {
            toast({
                description: "Your signature is needed to create the identity commitment.",
                variant: "subtle",
                isClosable: true
            })
            setLoading(false)
            return
        }

        const alreadyExist = await checkIdentityCommitment({
            provider: group.provider,
            name: group.name as ReputationLevel,
            identityCommitment
        })

        if (alreadyExist === null) {
            showUnexpectedError()
            return
        }

        if (alreadyExist) {
            toast({
                description: `You already joined this group with another ${capitalize(web2Provider)} account`,
                variant: "subtle",
                isClosable: true
            })
            setLoading(false)
            return
        }

        setIdentityCommitment(identityCommitment)
        setLoading(false)
        setCurrentStep(2)
    }

    async function joinGroup(group: Group, web2AccountId: string): Promise<void> {
        setLoading(true)

        const rootHash = await addIdentityCommitment({
            provider: group.provider,
            name: group.name as ReputationLevel,
            identityCommitment: _identityCommitment as string,
            web2AccountId
        })

        if (rootHash === null) {
            showUnexpectedError()
            return
        }

        setLoading(false)
        setCurrentStep(0)
        toast({
            description: `You joined the ${session?.user.reputation} ${capitalize(
                session?.web2Provider as string
            )} POAP group correctly.`,
            variant: "subtle",
            isClosable: true
        })
        setDescription("")
    }

    return !session || (_loading && _currentStep === 0) ? (
        <VStack h="300px" align="center" justify="center">
            <Spinner thickness="4px" speed="0.65s" size="xl" />
        </VStack>
    ) : (
        <>
            <Text fontWeight="semibold">{_description}</Text>

            <VStack mt="20px" spacing={4} align="left">
                <Step
                    title="Step 1"
                    message="Create your Semaphore identity."
                    actionText="Create Identity"
                    actionFunction={() =>
                        retrieveAndCheckIdentityCommitment(
                            _signer as Signer,
                            _group as Group,
                            session.web2Provider as Web2Provider
                        )
                    }
                    loading={_currentStep === 1 && _loading}
                    disabled={_currentStep !== 1}
                />
                <Step
                    title="Step 2"
                    message={`Join the ${session.user.reputation} ${capitalize(session.web2Provider as string)} group.`}
                    actionText="Join Group"
                    actionFunction={() => joinGroup(_group as Group, session.web2AccountId as string)}
                    loading={_currentStep === 2 && _loading}
                    disabled={_currentStep !== 2}
                />
            </VStack>
        </>
    )
}