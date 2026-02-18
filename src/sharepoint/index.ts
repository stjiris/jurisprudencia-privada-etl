import { JurisprudenciaVersion } from '@stjiris/jurisprudencia-document';
import { updateDrives } from './sharepoint.js';
import { client } from '../juris.js';

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
    /* let existsR = await client.indices.exists({ index: JurisprudenciaVersion }, { ignore: [404] });
    if (!existsR) {
        return showHelp(1, `${JurisprudenciaVersion} not found`);
    } */
    updateDrives();

}

main().catch(e => console.error(e));

