import { initialUpdateDrive, getDrivesIds, initializeGraphClient } from "./sharepoint_comunication";
import { Drive, DriveItem } from '@microsoft/microsoft-graph-types';
import { envOrFail, envOrFailDict, envOrFailArray } from './aux';
import { Report, report } from "./report/report";
import { JurisprudenciaVersion } from '@stjiris/jurisprudencia-document';
import { Client, PageCollection } from '@microsoft/microsoft-graph-client';
import dotenv from 'dotenv';
import { FileSystemUpdate } from "./filesystem";

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

async function insertDrive() {
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
        updated: 0
    }
    process.once("SIGINT", () => {
        info.dateEnd = new Date();
        console.log("Terminado a pedido do utilizador");
        report(info).then(() => process.exit(0));
    })

    let update: FileSystemUpdate = new FileSystemUpdate(drive_names, new Date(), new Date());

    for (const [drive_name, drive_id] of Object.entries(drive_ids)) {
        update.add(await initialUpdateDrive(drive_name, drive_id, root_path, graphClient, site_id));
    }

    info.dateEnd = new Date()
    await report(info)
}
/* 
async function updateToFileSystem() {
    if (FLAG_HELP) return showHelp(0);
    let info: Report = {
        created: 0,
        dateEnd: new Date(),
        dateStart: new Date(),
        deleted: 0,
        skiped: 0,
        soft: !FLAG_FULL_UPDATE,
        target: JurisprudenciaVersion,
        updated: 0
    }

    process.once("SIGINT", () => {
        info.dateEnd = new Date();
        console.log("Terminado a pedido do utilizador");
        report(info).then(() => process.exit(0));
    })

    const tenantId = envOrFail('TENANT_ID');
    const clientId = envOrFail('CLIENT_ID');
    const clientSecret = envOrFail('CLIENT_SECRET');
    const site_id = envOrFail("SITE_ID");
    const drive_names = envOrFailArray("DRIVES");
    const root_folder = envOrFail("LOCAL_ROOT");
    const delta_urls: Record<string, string> = envOrFailDict("DELTA_URLS");


    const graphClient: Client = initializeGraphClient(tenantId, clientId, clientSecret);
    const drivesDict: Record<string, string> = await getDrivesIds(graphClient, site_id, drive_names);

    for (const [drive_name, drive_delta] of Object.entries(drive_name_delta)) {
        update += await initialUpdateDrive(graphClient, site_id, drive_name, drive_id, root_path);
    }


    Object.entries(delta_urls).forEach(async (drive_name_delta) => {
        const new_info = await updateDrive(new FileSystemUpdate(drive_names, new Date(), new Date()), graphClient, drive_name_delta, root_folder);
    })


    info.dateEnd = new Date()
    await report(info)
}
 */
async function main() {
    dotenv.config();
    console.log(await insertDrive());
}

main().catch(e => console.error(e));


// test function
async function getDriveIds(): Promise<Record<string, string>> {
    const graphClient = getGraphClient();
    const site_id = envOrFail("SITE_ID");
    const drive_names = envOrFailArray("DRIVES");
    return getDrivesIds(graphClient, site_id, drive_names);
}
