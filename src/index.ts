import { JurisprudenciaVersion } from '@stjiris/jurisprudencia-document';
import { updateDrives } from './sharepoint';

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

async function main() {
    if (FLAG_HELP)
        return showHelp(0);

    updateDrives();
}

main().catch(e => console.error(e));

