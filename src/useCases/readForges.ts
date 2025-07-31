import { Internals } from "hyper-forge/internals"

let readForgesPromise: Promise<Internals.ForgeInfo[]> | undefined = undefined
let forges: Internals.ForgeInfo[] | undefined

export async function readForges() {
    const promise = Internals.HyperForgeData.readForges()
    readForgesPromise = promise

    forges = await promise
    if (promise == readForgesPromise)
        readForgesPromise = undefined
}

export async function getForges() {
    if (readForgesPromise) {
        await readForgesPromise
    }

    return [...forges!]
}