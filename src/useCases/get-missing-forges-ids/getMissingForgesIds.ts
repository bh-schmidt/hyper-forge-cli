import fs from 'fs-extra'
import { Internals } from 'hyper-forge/internals'

export async function getMissingForgesIds() {
    const config = await Internals.HyperForgeData.readConfig()
    const forges = Object.values(config.forges)

    const ids: string[] = []

    for (const forge of forges) {
        if (await fs.exists(forge.directory)) {
            continue
        }

        ids.push(forge.id)
    }

    return ids
}