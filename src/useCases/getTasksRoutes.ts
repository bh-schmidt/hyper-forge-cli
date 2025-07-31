import { RouteItem } from '@/types.js'
import { waitForCleanup } from '@/useCases/cleanUpExecutions.js'
import chalk from 'chalk'
import { Command } from 'commander'
import { Internals } from 'hyper-forge/internals'
import { RunnerProvider } from '../../../hyper-forge/dist/internals/Index.js'

export function getTasksRoutes(forge: Internals.ForgeInfo, program: Command): RouteItem[] {
    const defaultIndex = forge.tasks.findIndex(e => e.default)
    const routes = forge.tasks.map(task => {
        return {
            id: task.id,
            title: task.name,
            description: task.description,
            async execute() {
                await waitForCleanup()
                const runner = await RunnerProvider.getForgeRunner({
                    forge: forge,
                    task: task,
                })

                console.log(chalk.bold(`Starting the ${chalk.cyan(task.name)} task from the ${chalk.cyan(forge.name)} forge\n`))
                await runner.run()
                console.log(chalk.green.bold('The execution of your task just finished. Till next time!'))

                process.exit()
            }
        } as RouteItem
    })

    if (defaultIndex > -1) {
        const defaultRoute = routes[defaultIndex]
        routes.splice(defaultIndex, 1)
        routes.unshift(defaultRoute)
    }

    return routes
}
