import { JurisprudenciaVersion, PartialJurisprudenciaDocument } from '@stjiris/jurisprudencia-document';
import { client, indexJurisprudenciaDocumentFromURL, updateJurisprudenciaDocumentFromURL } from '../juris.js';
import dotenv from 'dotenv';
import { FilesystemUpdate } from '@stjiris/filesystem-lib';
import { terminateUpdate } from '../aux.js';
import { allLinks } from './crawler.js';

dotenv.config();

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
    process.stdout.write(`\t--help, -h\tshow this help\n`)
    process.exit(code);
}

async function main() {
    if (FLAG_HELP)
        return showHelp(0);
    const flag_full_update = process.env['FLAG_FULL_DGSI_UPDATE'] === "true" || FLAG_FULL_UPDATE
    let existsR = await client.indices.exists({ index: JurisprudenciaVersion }, { ignore: [404] });
    if (!existsR) {
        return showHelp(1, `${JurisprudenciaVersion} not found`);
    }
    let update: FilesystemUpdate = { updateSource: "DGSI", date_start: new Date(), file_errors: [] };

    process.once("SIGINT", () => {
        terminateUpdate(update, `Update terminated by user.`, "DGSI").then(() => process.exit(0));
    });

    for await (let l of allLinks()) {
        let id = await indexedUrlId(l);
        let doc: PartialJurisprudenciaDocument | undefined = undefined;
        if (id && flag_full_update) {
            doc = await updateJurisprudenciaDocumentFromURL(id, l);
            if (!doc)
                continue;
            if (!update.updated_num)
                update.updated_num = 0;
            update.updated_num++;
        }
        else {
            doc = await indexJurisprudenciaDocumentFromURL(l);
            if (!doc)
                continue;
            if (!update.created_num)
                update.created_num = 0;
            update.created_num++;
        }
    }

    terminateUpdate(update, "Finished DGSI update.", "DGSI")

}

main().catch(e => console.error(e));

async function indexedUrlId(url: string): Promise<string | undefined> {
    return client.search({
        index: JurisprudenciaVersion,
        query: {
            term: {
                "URL": url
            }
        },
        _source: false,
        size: 1
    }).then(r => r.hits.hits[0] ? r.hits.hits[0]._id : undefined);
}