import { allLinks } from "./dgsi-links";
import { JurisprudenciaVersion } from "@stjiris/jurisprudencia-document";
import { indexJurisprudenciaDocumentFromURL, updateJurisprudenciaDocumentFromURL } from "./crud-jurisprudencia-document-from-url";
import { client } from "./client";
import { Report, report } from "./report";
import { WriteResponseBase } from "@elastic/elasticsearch/lib/api/types";

const FLAG_FULL_UPDATE = process.argv.some(arg => arg === "-f" || arg === "--full");

const FLAG_HELP = process.argv.some(arg => arg === "-h" || arg === "--help");

function showHelp( code: number, error?: string ){
    if(error){
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

function indexedUrlId(url: string){
    return client.search({
        index: JurisprudenciaVersion,
        query: {
            term: {
                "URL": url
            }
        },
        _source: false,
        size: 1  
    }).then( r => r.hits.hits[0]? r.hits.hits[0]._id : null )
}


async function main(){
    if( FLAG_HELP ) return showHelp(0);
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

    let existsR = await client.indices.exists({index: JurisprudenciaVersion}, {ignore: [404]});
    if( !existsR ){
        return showHelp(1, `${JurisprudenciaVersion} not found`);
    }
    let i = 0;
    for await( let l of allLinks() ){
        let id = await indexedUrlId(l);
        i++;
        if( id && !FLAG_FULL_UPDATE ){
            continue;
        };
        let r: WriteResponseBase | undefined = undefined;
        if( id ){
            r = await updateJurisprudenciaDocumentFromURL(id, l);
        }
        else{
            r = await indexJurisprudenciaDocumentFromURL(l);
        }
        switch(r?.result){
            case "created":
                info.created++;
                break;
            case "deleted":
                info.deleted++;
                break;
            case "updated":
                info.updated++;
                break;
            case "noop":
            case "not_found":
            default:
                info.skiped++;
                break;
        }
    }

    info.dateEnd = new Date()
    await report(info)
}

main().catch(e => console.error(e));
