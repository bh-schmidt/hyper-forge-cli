import chalk from "chalk";
import { execa } from "execa";
import fs from 'fs-extra';
import { ForgeError, Utils } from "hyper-forge";
import { Internals } from "hyper-forge/internals";
import lodash from "lodash";

interface InstallOptions {
    repository: string
    branch?: string
    commit?: string
}

export async function installFromGitPrompt() {
    const answers = await Utils.Prompts.prompt([
        {
            name: 'repository',
            type: 'text',
            message: 'Inform the repository:',
            async validate(repo: string) {
                if (!repo || repo.trim() == '')
                    return 'Repository is required.'

                const { failed } = await execa('git ls-remote', [repo], { reject: false })
                if (failed) {
                    return 'Repository does not exist.'
                }

                return true
            }
        },
        {
            name: 'branch',
            type: 'text',
            message: 'Inform the branch:',
            initial: 'master/main',
            async validate(branch, answers) {
                if (branch == 'master/main') {
                    return true
                }

                const { failed } = await execa('git ls-remote --heads', [answers.repository, branch], { reject: false })
                if (failed) {
                    return 'Repository does not exist.'
                }

                return true
            }
        },
        {
            name: 'commit',
            type: 'text',
            message: 'Inform the commit:',
            initial: 'latest',
        }
    ])

    const options: InstallOptions = {
        repository: answers.repository,
        branch: answers.branch == 'master/main' ?
            undefined :
            answers.branch,
        commit: answers.commit == 'latest' ?
            undefined :
            answers.commit,
    }

    let repository: Internals.ClonedRepositories | undefined
    let repositoryExists = false
    try {
        const config = await Internals.HyperForgeData.readConfig()
        repository = await Internals.ForgeHandler.cloneRepository(options, config)
        if (!repository) {
            return false
        }

        repositoryExists = config.repositories.some(e => e.id == repository!.id)

        const success = await installInternal(repository, config, options)

        if (!success) {
            await deleteClonedRepository(repository, repositoryExists)
            return false
        }

        if (!repositoryExists) {
            config.repositories.push(repository)
        }

        await Internals.ForgeHandler.deleteOldRepositories(config)
        await Internals.HyperForgeData.saveConfig(config)

        return true
    } catch (error) {
        if (error instanceof ForgeError) {
            console.log(chalk.red(error.title))

            if (error.message) {
                console.log(error.message)
            }
        } else {
            console.log(chalk.red('An error ocurred:'))
            console.log(error)
        }

        await deleteClonedRepository(repository, repositoryExists);

        return false
    }
}

async function installInternal(repository: Internals.ClonedRepositories, config: Internals.ConfigObject, options: InstallOptions) {
    const repositoryExists = config.repositories.some(e => e.id == repository.id)
    const availableForges = await Internals.ForgeHandler.getAvailableForges(repository, config)
    if (availableForges.length == 0) {
        if (repositoryExists) {
            console.log(chalk.yellow('All forges of this repository are already installed.'))
        }
        else {
            console.log(chalk.red('No available forges found in this repository.'))
        }

        return false
    }

    const { selections } = await Utils.Prompts.prompt([{
        name: 'selections',
        type: 'multiselect',
        message: 'Select the forges to install:',
        choices: availableForges.map(e => {
            return {
                title: e.id
            }
        })
    }])
    const selectedForges = selections as number[]
    if (selectedForges.length == 0) {
        console.log(chalk.yellow('No forge selected.'))
        return false
    }

    const forgesToInstall = selectedForges.map((e: number) => availableForges[e])
    const forgesToReplace = await Internals.ForgeHandler.getForgesToReplace(forgesToInstall, repository, config)
    if (forgesToReplace.length > 0) {
        const text = forgesToReplace.map(e => e.id).join('\n\t')

        const { replace } = await Utils.Prompts.prompt({
            name: 'replace',
            type: 'confirm',
            message: `The following forges are already installed:\n\t${text}\nReplace them?`
        })

        if (!replace) {
            for (const forge of forgesToReplace) {
                lodash.remove(forgesToInstall, f => f.id == forge.id)
            }
        }
    }

    if (forgesToInstall.length == 0) {
        console.log(chalk.yellow('No forges to install.'))
        return false
    }

    for (const forge of forgesToInstall) {
        config.forges[forge.id] = {
            id: forge.id,
            directory: forge.directory,
            repositoryId: repository.id,
            rebuildStrategy: forge.isTypescript ?
                'dist-missing' :
                undefined
        }
    }

    return true
}

async function deleteClonedRepository(repository: Internals.ClonedRepositories | undefined, repositoryExists: boolean) {
    if (repository) {
        const path = Internals.HyperForgeData.getGitForgesPath(repository.id);
        if (!repositoryExists && await fs.exists(path)) {
            await fs.rm(path, { recursive: true });
        }
    }
}
