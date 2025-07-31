import chalk from 'chalk'
import fs from 'fs-extra'
import { globStream } from 'glob'
import { Internals } from 'hyper-forge/internals'
import { basename, join } from 'path'
import { lock } from 'proper-lockfile'

let cleanupPromise: Promise<void> | undefined

export function cleanup() {
    cleanupPromise = cleanupInternal()
        .then(() => {
            cleanupPromise = undefined
        })
}

export async function waitForCleanup() {
    if (cleanupPromise) {
        await cleanupPromise
    }
}
async function cleanupInternal() {
    await cleanUpExecutions()
    await cleanupRepositories()
}

async function cleanUpExecutions() {
    const directories = globStream('*/', {
        absolute: true,
        cwd: Internals.executionsTempDirectory,
        stat: true,
    })

    let hadError = false

    for await (const directory of directories) {
        if (await shouldIgnore(directory)) {
            continue
        }

        try {
            await fs.rm(directory, { recursive: true })
        } catch (error) {
            console.log(chalk.red(`An error ocurred removing an old execution directory (${directory})\n\n${error}`))
            hadError = true
        }
    }

    if (hadError) {
        await new Promise(res => {
            setTimeout(() => {
                res(null)
            }, 10_000);
        })
    }
}

async function shouldIgnore(directory: string) {
    const lockPath = join(directory, '.lock')

    if (!await fs.exists(lockPath)) {
        return false
    }

    try {
        const release = await lock(lockPath, { retries: 0 })
        await release()

        return false
    } catch (error) {
        return true
    }
}

async function cleanupRepositories() {
    const gitPath = Internals.HyperForgeData.getGitForgesPath()
    const config = await Internals.HyperForgeData.readConfig()
    const ids = new Set(config.repositories.map(e => e.id))

    const paths = globStream('*', {
        absolute: true,
        cwd: gitPath,
        stat: true,
    })

    for await (const path of paths) {
        const baseName = basename(path)
        if (ids.has(baseName)) {
            continue
        }

        await fs.rm(path, { recursive: true })
    }
}