import { updateDrive, getDrivesIds, initializeGraphClient } from "./sharepoint_comunication";
import { Drive, DriveItem } from '@microsoft/microsoft-graph-types';
import { envOrFail, envOrFailDict, envOrFailArray } from './aux';
import { Report, report } from "./report/report";
import { JurisprudenciaVersion } from '@stjiris/jurisprudencia-document';
import { Client, PageCollection } from '@microsoft/microsoft-graph-client';
import dotenv from 'dotenv';
import { FileSystemUpdate } from "./filesystem";
import { addJurisprudencia } from "./juris";
import { client } from "./client";

const FLAG_FULL_UPDATE = process.argv.some(arg => arg === "-f" || arg === "--full");

const FLAG_HELP = process.argv.some(arg => arg === "-h" || arg === "--help");

function showHelp(code: number, error?: string) {
    if (error) {
        process.stderr.write(`Error: ${error}\n\n`);
    }
    process.stdout.write(`Usage: ${process.argv0} ${__filename} [OPTIONS]\n`)

    process.stdout.write(`Populate Jurisprudencia index. (${JurisprudenciaVersion})\n`)
    process.stdout.write(`Use ES_URL, ES_USER and ES_PASS environment variables to setup the elasticsearch client\n`)
    process.stdout.write(`Options:\n`)
    process.stdout.write(`\t--full, -f\tWork in progress. Should update every document already indexed and check if there are deletions\n`);
    process.stdout.write(`\t--help, -h\tshow this help\n`)
    process.exit(code);
}

// setup microsoft graph client
function getGraphClient(): Client {
    const tenantId = envOrFail('TENANT_ID');
    const clientId = envOrFail('CLIENT_ID');
    const clientSecret = envOrFail('CLIENT_SECRET');
    return initializeGraphClient(tenantId, clientId, clientSecret);
}

async function insertDrive(): Promise<void | FileSystemUpdate> {
    const graphClient = getGraphClient();
    const site_id = envOrFail("SITE_ID");
    const drive_names = envOrFailArray("DRIVES");
    const root_path = envOrFail("LOCAL_ROOT");
    const drive_ids = await getDrivesIds(graphClient, site_id, drive_names)

    if (FLAG_HELP) return showHelp(0);
    let info: Report = {
        created: 0,
        dateEnd: new Date(),
        dateStart: new Date(),
        deleted: 0,
        skiped: 0,
        soft: !FLAG_FULL_UPDATE,
        target: JurisprudenciaVersion,
        updated: 0,
        updated_metadata: 0
    }
    process.once("SIGINT", () => {
        update.date_end = new Date();
        info = {
            created: update.created_num,
            dateEnd: update.date_end,
            dateStart: update.date_start,
            deleted: update.deleted_num,
            skiped: 0,
            soft: !FLAG_FULL_UPDATE,
            target: JurisprudenciaVersion,
            updated: update.updated_num,
            updated_metadata: update.updated_metadata_num
        }
        console.log("Terminado a pedido do utilizador");
        report(info).then(() => process.exit(0));
    })

    let update: FileSystemUpdate = new FileSystemUpdate();

    for (const [drive_name, drive_id] of Object.entries(drive_ids)) {
        update.add_update(await updateDrive(drive_name, drive_id, root_path, graphClient, site_id));
    }
    update.date_end = new Date();
    update.write(root_path);

    info = {
        created: update.created_num,
        dateEnd: update.date_end,
        dateStart: update.date_start,
        deleted: update.deleted_num,
        skiped: 0,
        soft: !FLAG_FULL_UPDATE,
        target: JurisprudenciaVersion,
        updated: update.updated_num,
        updated_metadata: update.updated_metadata_num
    }
    try {
        await report(info)
    } catch (e) {
        console.error(e);
    }
    return update;
}

async function main() {
    dotenv.config();
    const update = await insertDrive();
    if (!update)
        return;
    addJurisprudencia(update, envOrFail("LOCAL_ROOT"), client);
}

main().catch(e => console.error(e));

