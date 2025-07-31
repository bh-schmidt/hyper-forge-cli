import { RouteItem } from "@/types.js";
import { getTasksRoutes } from "@/useCases/getTasksRoutes.js";
import { getForges } from "@/useCases/readForges.js";
import { Command } from "commander";

export async function getForgesRoutes(program: Command): Promise<RouteItem[]> {
    const forges = await getForges()
    forges.sort((a, b) => a.name.localeCompare(b.name))

    return forges.map(forge => {
        return {
            id: forge.id,
            title: forge.name,
            description: forge.description,
            question: 'Select the task:',
            type: 'autocomplete',
            items: getTasksRoutes(forge, program),
        } as RouteItem;
    })
}