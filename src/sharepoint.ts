import { Client } from "@microsoft/microsoft-graph-client";
import { Report, report } from "./report/report";
import { addFileToUpdate, ContentType, createJurisprudenciaDocument, Date_Area_Section, FilesystemDocument, FilesystemUpdate, generateFilePath, isSupportedExtension, loadLastFilesystemUpdate, logDocumentProcessingError, Retrievable_Metadata, Sharepoint_Metadata, Supported_Content_Extensions, SupportedUpdateSources, writeFilesystemDocument, writeFilesystemUpdate } from "./filesystem";
import { ClientSecretCredential } from "@azure/identity";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { JurisprudenciaVersion, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";
import { indexJurisDocument } from "./juris";
import dotenv from 'dotenv';
import path from "path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { spawn } from 'child_process';

dotenv.config();
const tenantId = envOrFail('TENANT_ID');
const clientId = envOrFail('CLIENT_ID');
const clientSecret = envOrFail('CLIENT_SECRET');
const site_id = envOrFail("SITE_ID");
const drive_names = process.env['DRIVES'] || ["Anonimização"];
const pythonScriptPath = "src/pdf_parser.py";
const client = Client.initWithMiddleware({ authProvider: new TokenCredentialAuthenticationProvider(new ClientSecretCredential(tenantId, clientId, clientSecret), { scopes: ['https://graph.microsoft.com/.default'] }) });

type Retrievable_Metadata_Table = Record<string, Retrievable_Metadata>;

const SECTIONTOAREA: Record<string, string> = {
    "1ª Secção": "Área Cível",
    "2ª Secção": "Área Cível",
    "3ª Secção": "Área Criminal",
    "4ª Secção": "Área Social",
    "5ª Secção": "Área Criminal",
    "6ª Secção": "Área Cível",
    "7ª Secção": "Área Cível",
    "Contencioso": "Contencioso",
    "Cnflitos": "Conflitos",
};

export async function updateDrives() {
    const last_update: FilesystemUpdate = loadLastFilesystemUpdate();
    const drive_id_names = await getDrivesIdNames();

    for (const [drive_name, drive_id] of Object.entries(drive_id_names)) {
        await updateDrive(drive_name, drive_id, last_update);
    }
}

async function updateDrive(drive_name: string, drive_id: string, lastUpdate: FilesystemUpdate): Promise<void> {
    console.log(drive_name);
    process.once("SIGINT", () => {
        terminateUpdate(update, `Update terminated by user.`).then(() => process.exit(0));
    });

    // update initialization
    let update: FilesystemUpdate = { updateSource: "STJ (Sharepoint)", date_start: new Date(), file_errors: [] };
    let next = lastUpdate.next_link || lastUpdate.delta_link || `/sites/${encodeURIComponent(site_id)}/drives/${encodeURIComponent(drive_id)}/root/delta`;
    let i = 0;

    while (next) {
        const normalized = normalizeGraphUrlToPath(next);

        // get page with updates
        const page_of_documents = await client.api(normalized).get();

        update.delta_link = page_of_documents["@odata.deltaLink"];
        update.next_link = page_of_documents["@odata.nextLink"];
        const retrievable_metadata_tables: Record<string, Retrievable_Metadata_Table> = {};

        for (const drive_item of page_of_documents.value) {
            if (drive_item.deleted) {
                continue;
            }
            if (drive_item.folder) {
                continue;
            }
            if (!drive_item.file) {
                continue;
            }
            try {
                i += 1;
                // read sharepoint exclusive info
                const sharepoint_metadata: Sharepoint_Metadata = readSharepoint_Metadata(drive_item, drive_name, drive_id);

                // initialize creation and update dates for future updates
                const creation_date: Date = new Date();
                const last_update_date: Date = creation_date;
                const date_area_section: Date_Area_Section = getDateAreaSection(sharepoint_metadata);

                /* if (!sharepoint_metadata.extensions.includes("pdf") || !sharepoint_metadata.sharepoint_path_rel.toLowerCase().includes("secção") || !sharepoint_metadata.sharepoint_path_rel.toLowerCase().includes("2025")) {
                    throw new Error("Tem Texto.");
                } */

                if (!(path.dirname(sharepoint_metadata.sharepoint_path_rel) in retrievable_metadata_tables)) {
                    retrievable_metadata_tables[path.dirname(sharepoint_metadata.sharepoint_path_rel)] = await retrieveSharepointTable(sharepoint_metadata);
                }

                // retrieves actual metadata from sharepoint documents
                const retrievable_metadata: Retrievable_Metadata = getRetrievableMetadata(retrievable_metadata_tables[path.dirname(sharepoint_metadata.sharepoint_path_rel)], sharepoint_metadata);

                // retrieves actual decision content
                const content: ContentType[] = await retrieveSharepointContent(sharepoint_metadata);

                // creates jurisprudencia document for indexing later and to store metadata in a standard way
                const jurisprudencia_document: PartialJurisprudenciaDocument = await createJurisprudenciaDocument(retrievable_metadata, content, date_area_section, sharepoint_metadata);

                // if there is enough metadata associated with the document, then it is inserted into the filesystem
                // otherwise it's just made a copy that is stored in the sharepoint copy, could be useful for backups idk
                const file_path: string = generateFilePath(date_area_section, retrievable_metadata);

                const filesystem_document: FilesystemDocument = {
                    creation_date,
                    last_update_date,
                    jurisprudencia_document,
                    content,
                    file_path,
                    sharepoint_metadata
                }

                // write the document in the juris platform if it is available
                //indexJurisDocument(filesystem_document);

                // write the document to the system
                writeFilesystemDocument(filesystem_document);
                addFileToUpdate(update, filesystem_document);


            } catch (err: unknown) {
                if (err instanceof Error) {
                    // this should log the exact issue with the file
                    let file_name = (drive_item?.parentReference.path ?? '') + (drive_item?.name ?? '');
                    logDocumentProcessingError(update, `Error processessing file ${file_name}, number ${i} of drive ${drive_name}: ` + err.message);
                }
            }

        }
        // this is just a counter of all files seen in pages
        //console.log("i: ", i);

        if (update.delta_link) {
            update.next_link = undefined;
            break;
        }

        if (update.next_link) {
            next = update.next_link;
            continue;
        }

        throw new Error("Update page doesn't have next or delta page.");
    }

    terminateUpdate(update, `Drive ${drive_name} updated.`);
}

function getDateAreaSection(sharepoint_metadata: Sharepoint_Metadata): { file_date: Date, area: string, section: string } {
    let file_date: Date | undefined = undefined;
    let area: string | undefined = undefined;
    let section: string | undefined = undefined;
    const matches = [...path.dirname(sharepoint_metadata.sharepoint_path_rel).matchAll(/(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?/g)];
    const last = matches.at(-1);
    if (last) {
        const day = parseInt(last[1], 10);
        const month = parseInt(last[2], 10);
        const year = parseInt(last[3] ?? new Date().getFullYear(), 10);
        file_date = new Date(year, month - 1, day);
    }

    const lower = sharepoint_metadata.sharepoint_path_rel.toLowerCase();
    for (const key of Object.keys(SECTIONTOAREA)) {
        if (lower.includes(key.toLowerCase())) {
            section = key;
            area = SECTIONTOAREA[key];
            break;
        }
    }
    if (!(file_date && area && section)) {
        throw new Error("Date ou Area ou Secção não puderam ser extraidas do caminho do sharepoint.");
    }

    return { file_date, area, section };
}

async function getDrivesIdNames(): Promise<Record<string, string>> {
    const result = await client.api(`/sites/${site_id}/drives`).select("id,name").get();
    type Drive = { id: string; name: string };
    const all_drives = (result.value ?? []) as Array<Drive>;
    const drives = all_drives.filter((d) => d && d.name && d.id && drive_names.includes(d.name));
    const drives_dict = drives.reduce<Record<string, string>>((acc, drive) => {
        if (drive.name) acc[drive.name] = drive.id;
        return acc;
    }, {});

    return drives_dict;
}

async function retrieveSharepointTable(sharepoint_metadata: Sharepoint_Metadata): Promise<Retrievable_Metadata_Table> {
    const response = await client.api(`/drives/${sharepoint_metadata.drive_id}/items/${sharepoint_metadata.parent_sharepoint_id}/children`).get();

    const tabelaRegex = /.*tabela.*\.pdf$/i;
    const matchingFile = response.value.find((item: any) => item.file && tabelaRegex.test(item.name.toLowerCase()));

    if (!matchingFile) {
        throw new Error(`Nenhuma *tabela*.pdf encontrada associada ao ficheiro  ${sharepoint_metadata.sharepoint_path_rel}`);
    }

    const webStream = await client.api(`/drives/${sharepoint_metadata.drive_id}/items/${matchingFile.id}/content`).get();

    const reader = webStream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(value);
    }

    const fileContent = Buffer.concat(chunks.map(c => Buffer.from(c)));

    const parsed_rows = await parseMetadataTable(fileContent);
    const table: Retrievable_Metadata_Table = parsed_rows.reduce(
        (acc, row) => {
            const key = row["Processo"];

            if (!key)
                return acc;

            acc[key] = { process_number: row["Processo"], judge: row["Relator"], process_mean: row['Espécie'], decision: row['Decisão'] };
            return acc;
        },
        {} as Retrievable_Metadata_Table
    );
    return table;
}

type Row = Record<string, string>;

async function parseMetadataTable(buffer: Buffer): Promise<Row[]> {
    return new Promise((resolve, reject) => {
        const py = spawn("python3", [pythonScriptPath], { stdio: ["pipe", "pipe", "pipe"] });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        py.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
        py.stderr.on("data", (chunk: Buffer) => {
            stderrChunks.push(chunk);
            console.error("[python stderr]", chunk.toString());
        });

        py.on("error", (err) => reject(err));

        py.on("close", (code) => {
            const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
            const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

            if (code !== 0) {
                return reject(new Error(`Python exited with code ${code}. Stderr: ${stderr}`));
            }

            if (!stdout) {
                return reject(new Error(`No output from Python. Stderr: ${stderr}`));
            }

            try {
                const parsed = JSON.parse(stdout) as Row[];
                resolve(parsed);
            } catch (err) {
                reject(
                    new Error(
                        `Failed to parse JSON from Python stdout. Error: ${(err as Error).message}\nStdout: ${stdout.slice(
                            0,
                            2000
                        )}\nStderr: ${stderr}`
                    )
                );
            }
        });

        py.stdin.on("error", (err) => {
            console.error("[python stdin error]", err);
        });

        try {
            py.stdin.write(buffer, () => py.stdin.end());
        } catch (err) {
            console.error("[stdin write failed]", err);
            py.stdin.end();
        }
    });
}

function getRetrievableMetadata(retrievable_metadata_table: Retrievable_Metadata_Table, sharepoint_metadata: Sharepoint_Metadata): Retrievable_Metadata {
    const original_file_name: string = path.basename(sharepoint_metadata.sharepoint_path_rel).replace("-", "/");
    const matchedKey = Object.keys(retrievable_metadata_table).find(k => original_file_name.includes(k));
    if (!matchedKey) {
        throw new Error("Metadata não encontrada dentro da tabela correspondente.");
    }
    return retrievable_metadata_table[matchedKey];
}

async function terminateUpdate(update: FilesystemUpdate, message: string): Promise<void> {
    update.date_end = new Date();
    const info: Report = {
        dateStart: update.date_start,
        dateEnd: update.date_end,
        created: update.created_num || 0,
        deleted: update.deleted_num || 0,
        updated: update.updated_num || 0,
        target: JurisprudenciaVersion,
    }
    console.log(message);
    try {
        writeFilesystemUpdate(update);
        console.log(info);
        // report(info)
    } catch (e) {
        console.error(e);
    }
}

function readSharepoint_Metadata(drive_item: any, drive_name: string, drive_id: string): Sharepoint_Metadata {
    if (drive_item.id === null || drive_item.id === undefined) {
        throw new Error("Missing drive_item.id");
    }
    if (drive_item.parentReference?.path === null || drive_item.parentReference?.path === undefined) {
        throw new Error("Missing parentReference.path");
    }
    if (drive_item.webUrl === null || drive_item.webUrl === undefined) {
        throw new Error("Missing webUrl");
    }
    if (drive_item.name === null || drive_item.name === undefined) {
        throw new Error("Missing file name");
    }
    if (drive_item.parentReference.id === null || drive_item.parentReference.id === undefined) {
        throw new Error("Missing parent reference id");
    }

    const sharepoint_id = drive_item.id;
    const parent_sharepoint_id = drive_item.parentReference.id;
    const sharepoint_path = drive_item.parentReference.path + '/' + drive_item.name;
    const sharepoint_path_rel = generateRelPath(sharepoint_path, drive_id, drive_name);
    const sharepoint_url = drive_item.webUrl;
    const xor_hash: string | undefined = drive_item.file.hashes.quickXorHash;
    const extensions: Supported_Content_Extensions[] = [getSupportedExtension(drive_item.name),];

    return {
        drive_name,
        drive_id,
        sharepoint_id,
        parent_sharepoint_id,
        sharepoint_path,
        sharepoint_path_rel,
        sharepoint_url,
        extensions,
        xor_hash,
    };
}

export function getSupportedExtension(filename: string): Supported_Content_Extensions {
    const ext = path.extname(filename).slice(1).toLowerCase();

    if (!isSupportedExtension(ext)) {
        throw new Error(`Unsupported file extension: ${ext}`);
    }

    return ext;
}


function generateRelPath(sharepoint_path: string, drive_id: string, drive_name: string): string {
    if (!sharepoint_path)
        return `/${drive_name}`;

    const marker = `/drives/${drive_id}`;
    const start = sharepoint_path.indexOf(marker);

    let rest = start >= 0 ? sharepoint_path.slice(start + marker.length) : sharepoint_path;

    rest = rest.replace(/^\/drive\/root:|^\/root:|^:/, "");

    if (!rest.startsWith("/"))
        rest = "/" + rest;

    return `/${drive_name}${rest}`;
}

async function retrieveSharepointContent(sharepoint_metadata: Sharepoint_Metadata): Promise<ContentType[]> {
    let contents: ContentType[] = []
    for (const extension of sharepoint_metadata.extensions) {
        const webStream = await client
            .api(`/drives/${sharepoint_metadata.drive_id}/items/${sharepoint_metadata.sharepoint_id}/content`)
            .get();

        const reader = webStream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        contents.push({ extension: extension, data: Buffer.concat(chunks.map(c => Buffer.from(c))) });
    }
    return contents;
}

function envOrFail(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
}

function normalizeGraphUrlToPath(url: string): string {
    if (url.startsWith("/")) return url;
    return url.replace(/^https?:\/\/graph\.microsoft\.com(\/v1\.0|\/beta)?/, "");
}
