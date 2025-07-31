#!/usr/bin/env node

import { buildRootRoute, runRoute } from "@/router.js"
import { cleanup, waitForCleanup } from "@/useCases/cleanUpExecutions.js"
import { getForges, readForges } from "@/useCases/readForges.js"
import chalk from "chalk"
import { Argument, Command, Option } from "commander"
import { ForgeError, Utils } from 'hyper-forge'
import { Internals } from "hyper-forge/internals"
import PackageJson from '../package.json' with { type: 'json' }
readForges()
cleanup()

const program = new Command('hf')

const list = new Command('list')
    .description('Lists all installed forges and its tasks')
    .action(async () => {
        const forges = await getForges()
        forges.sort((a, b) => {
            return a.id.localeCompare(b.id)
        })

        console.log(chalk.bold('Available forges:'))
        for (const forge of forges) {
            console.log(` - ${chalk.blue(forge.id)} - ${forge.description}`)

            forge.tasks.sort((a, b) => a.id.localeCompare(b.id))
            for (const task of forge.tasks) {
                console.log(`   - ${chalk.green(task.id)} - ${task.description}`)
            }
            console.log()
        }
    })

const runCommand = new Command('run')
    .description('Run a forge task')
    .argument('[forge]', 'The id of the forge')
    .argument('[task]', 'The id of the task')
    .option('--rebuild', 'Rebuilds typescript projects')
    .option('--list', 'Lists all the available variables on the specified forge task.')
    .addOption(
        new Option('-s, --set <keyValue>', 'Sets a variable')
            .argParser((keyValue, prev: any) => {
                prev ??= {}

                if (!keyValue.includes('=')) {
                    throw new ForgeError('Incorrect set usage.', 'Correct usage: key=value.')
                }

                const match = keyValue.match(/([a-zA-Z0-9-_]+)=(.+)/)
                if (!match) {
                    throw new ForgeError('Incorrect set usage.', ' - usage: key=value.')
                }

                const key = match[1]
                const value = match[2]

                prev[key] = value

                return prev
            })
    )
    .usage('<forge-id> <task-id> [options]')
    .allowExcessArguments()
    .allowUnknownOption()
    .action(async (forgeId, taskId) => {
        await waitForCleanup()

        const opts = runCommand.opts()
        if (!taskId && opts.help) {
            runCommand.help()
        }

        if (!forgeId) {
            throw new ForgeError(`Missing required argument 'forge-id'.`)
        }

        if (!taskId) {
            throw new ForgeError(`Missing required argument 'task-id'.`)
        }

        const forges = await getForges()
        if (!forges || forges.length == 0) {
            console.log(chalk.red('No forges installed'))
            process.exit(1)
        }

        const forge = forges.find(e => e.id == forgeId)
        if (!forge) {
            console.log(chalk.red('Forge does not exist'))
            process.exit(1)
        }

        const task = forge?.tasks.find(e => e.id == taskId)
        if (!task) {
            console.log(chalk.red('Task does not exist'))
            process.exit(1)
        }

        await waitForCleanup()
        const runner = await Internals.RunnerProvider.getForgeRunner({
            forge: forge!,
            task: task!,
            rebuild: opts.rebuild,
            variables: opts.set
        })

        if (opts.list) {
            const forge = runner.getForge()
            const mapper = forge.variables.mapper

            const entries = Object.entries(mapper.map)
            const maxSize = entries.reduce((final, curr) => curr[0].length > final ? curr[0].length : final, 0)
            const padding = maxSize + 4

            const reserved: typeof entries = []
            const common: typeof entries = []
            for (const entry of entries) {
                if (entry[1].isReserved) {
                    reserved.push(entry)
                } else {
                    common.push(entry)
                }
            }

            console.log(chalk.bold('System variables:'))
            for (const [name, variable] of reserved) {
                console.log(` - ${name.padEnd(padding)}${variable.description ?? ''}`)
            }

            console.log()
            console.log(chalk.bold('Forge variables:'))
            for (const [name, variable] of common) {
                console.log(` - ${name.padEnd(padding)}${variable.description ?? ''}`)
            }

            return
        }

        console.log(chalk.bold(`Starting the ${chalk.cyan(task.name)} task from the ${chalk.cyan(forge.name)} forge\n`))
        await runner.run()
        console.log(chalk.green.bold('The execution of your task just finished. Till next time!'))
    })

const uninstallCommand = new Command('uninstall')
    .description('Uninstalls a forge')
    .argument('[forge-id]', 'The id of the forge')
    .option('--missing-directories', 'Uninstall forges whose directories are missing')
    .action(async (forgeId) => {
        const opts = uninstallCommand.opts()
        if (!opts.missingDirectories && !forgeId) {
            throw new ForgeError(`Either 'forge-id' or --missing-directories should be informed`)
        }

        if (forgeId) {
            await Internals.ForgeHandler.uninstallForge(forgeId)
        }

        if (opts.missingDirectories) {
            await Internals.ForgeHandler.uninstallMissingForges()
        }
    })

const installCommand = new Command('install')
    .description('Install a forge')

installCommand.addCommand(
    new Command('git')
        .description('Install a forge stored in a git repository')
        .argument('<forges...>', 'The ids of the forges to install or * to install every forge in the repository')
        .requiredOption('-r, --repository <repository>', 'Repository of the forge/forges')
        .option('-b, --branch <branch>', 'Branch of the forge')
        .option('-c, --commit <commit>', 'Commit of the forge')
        .option('--replace', 'Replaces all informed forges if they are already installed')
        .configureHelp({
            styleUsage() {
                return `
  Install every forge in the repository
    hf install git * -r https://example.com/

  Install pre-selected forges in the repository
    hf install git my-forge1 my-forge2 -r https://example.com/`
            },
        })
        .action(async (forgeIds, options) => {
            await Internals.ForgeHandler.installGitForge({
                forgeIds: forgeIds,
                repository: options.repository,
                branch: options.branch,
                commit: options.commit,
                replace: options.replace
            })
        })
)

installCommand.addCommand(
    new Command('local-dir')
        .description('Install a forge stored in a local directory')
        .argument('<directory>', 'Root directory of the forge')
        .option('--replace', 'Replaces the current existing forge')
        .addOption(
            new Option('--rebuild-strategy <strategy>', 'Sets the strategy to decide whether to rebuild the forge or not')
                .choices(Utils.rebuildStrategies)
        )
        .action(async (dir, options) => {
            await Internals.ForgeHandler.installDirForge({
                directory: dir,
                replace: options.replace,
                rebuildStrategy: options.rebuildStrategy
            })
        })
)

const config = new Command('config')
    .description('Shows, sets or deletes config values of the current directory')

const getConfig = new Command('get')
const setConfig = new Command('set')
const deleteConfig = new Command('delete')
config
    .addCommand(getConfig)
    .addCommand(setConfig)
    .addCommand(deleteConfig)

getConfig
    .argument('<key>', 'The key of the config')
    .addOption(
        new Option('--scope <scope>', 'The scope of the config')
            .choices(['task', 'forge', 'project'])
    )
    .option('--forge <id>', 'The id of the forge in which the task belongs')
    .option('--task <id>', 'The id of the task')
    .option('--recursive', 'Also merges values with parent configs.')
    .action(async (key, options) => {
        if (!options.forge && (!options.scope || options.scope == 'task' || options.scope == 'forge')) {
            throw new ForgeError('Forge id is required')
        }

        if (!options.task && (!options.scope || options.scope == 'task')) {
            throw new ForgeError('Task id is required')
        }

        const value = await Internals.ConfigHandler.getConfig({
            directory: process.cwd(),
            key,
            scope: options.scope,
            forgeId: options.forge,
            taskId: options.task,
            recursive: options.recursive
        })
        console.log(value)
    })

setConfig
    .addArgument(
        new Argument('<scope>', 'The scope of the config')
            .choices(['task', 'forge', 'project'])
    )
    .argument('<key>', 'The key of the config')
    .argument('<value>', 'The value to set in the config')
    .option('--forge <id>', 'The id of the forge in which the task belongs')
    .option('--task <id>', 'The id of the task')
    .option('--as-json', 'Parses the value as a json')
    .action(async (scope, key, value, opts) => {
        if (!opts.forge && (scope == 'task' || scope == 'forge')) {
            throw new ForgeError('Forge id is required')
        }

        if (!opts.task && (scope == 'task')) {
            throw new ForgeError('Task id is required')
        }

        await Internals.ConfigHandler.setConfig({
            directory: process.cwd(),
            key: key,
            scope: scope,
            value: value,
            forgeId: opts.forge,
            taskId: opts.task
        })
    })

deleteConfig
    .addArgument(
        new Argument('<scope>', 'The scope of the config')
            .choices(['task', 'forge', 'project'])
    )
    .argument('<key>', 'The key of the config')
    .option('--forge <id>', 'The id of the forge in which the task belongs')
    .option('--task <id>', 'The id of the task')
    .action(async (scope, key, opts) => {
        if (!opts.forge && (scope == 'task' || scope == 'forge')) {
            throw new ForgeError('Forge id is required')
        }

        if (!opts.task && (scope == 'task')) {
            throw new ForgeError('Task id is required')
        }
        await Internals.ConfigHandler.deleteConfig({
            directory: process.cwd(),
            key: key,
            scope: scope,
            forgeId: opts.forge,
            taskId: opts.task
        })
    })

try {
    await program
        .addCommand(list)
        .addCommand(runCommand)
        .addCommand(installCommand)
        .addCommand(uninstallCommand)
        .addCommand(config)
        .version(PackageJson.version, '-v, --version')
        .option('--verbose', 'Enables verbose log mode.')
        .configureHelp({
            sortOptions: true,
            sortSubcommands: true,
            styleUsage() {
                return `
  Run the console interface
    hf

  Run the specified command
    hf <command> [options]`
            },
            subcommandTerm(cmd) {
                return cmd.name()
            }
        })
        .action(async () => {
            await waitForCleanup()
            const root = buildRootRoute(program)
            await runRoute(root)
        })
        .parseAsync()
} catch (error) {
    console.log(chalk.red.bold('An error ocurred:'))

    if (error instanceof ForgeError) {
        console.log(error.title)

        if (error.description) {
            console.log(error.description)
        }

        if (program.opts()?.verbose) {
            console.log(error.stack)
        }

        process.exit(1)
    }

    if (error instanceof Error) {
        console.log(error.message)

        if (program.opts()?.verbose) {
            console.log(error.stack)
        }

        process.exit(1)
    }

    console.log(error)
    process.exit(1)
}