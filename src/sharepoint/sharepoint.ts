import { Client } from "@microsoft/microsoft-graph-client";
import { addFileToUpdate, clearReintroductionMarker, ContentType, Date_Area_Section, DETAILS_NAME, FilesystemDocument, FilesystemUpdate, FILESYSTEM_PATH, generateFilePath, isSupportedExtension, loadCachedNlpFromDetalhes, loadLastFilesystemUpdate, loadPendingReintroductions, logDocumentProcessingError, Retrievable_Metadata, ROOT_PATH, Sharepoint_Metadata, Supported_Content_Extensions, SupportedUpdateSources, writeContentToDocument, writeFilesystemDocument, writeFilesystemUpdate } from "@stjiris/filesystem-lib";
import { ClientSecretCredential } from "@azure/identity";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { calculateHASH, JurisprudenciaDocument, JurisprudenciaVersion, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";
import { updateJurisDocument, client as esClient } from "../juris.js";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { estypes } from "@elastic/elasticsearch";
import { createJurisprudenciaDocument, terminateUpdate } from "../aux.js";

dotenv.config(); // loads .env if present; no-op otherwise (e.g. in docker)
const tenantId = envOrFail("TENANT_ID");
const clientId = envOrFail("CLIENT_ID");
const clientSecret = envOrFail("CLIENT_SECRET");
const site_id = envOrFail("SITE_ID");
const drive_names = process.env["DRIVES"] || ["Anonimização"];
const pythonScriptPath = "src/sharepoint/pdf_parser.py";
const client = Client.initWithMiddleware({ authProvider: new TokenCredentialAuthenticationProvider(new ClientSecretCredential(tenantId, clientId, clientSecret), { scopes: ["https://graph.microsoft.com/.default"] }) });

type Retrievable_Metadata_Table = Record<string, Retrievable_Metadata>;

const SECTIONTOAREA: Record<string, string> = {
    "1ª Secção": "Área Cível",
    "2ª Secção": "Área Cível",
    "3ª Secção": "Área Criminal",
    "4ª Secção": "Área Social",
    "5ª Secção": "Área Criminal",
    "6ª Secção": "Área Cível",
    "7ª Secção": "Área Cível",
    Contencioso: "Contencioso",
    Cnflitos: "Conflitos"
};

const SECTIONTOSECTION: Record<string, string> = {
    "1ª Secção": "1ª Secção (Cível)",
    "2ª Secção": "2ª Secção (Cível)",
    "3ª Secção": "3ª Secção (Criminal)",
    "4ª Secção": "4ª Secção (Social)",
    "5ª Secção": "5ª Secção (Criminal)",
    "6ª Secção": "6ª Secção (Cível)",
    "7ª Secção": "7ª Secção (Cível)",
    Contencioso: "Contencioso",
    Cnflitos: "Conflitos"
};

type ComplementaryCheck = { type: 'merged'; existingDoc: JurisprudenciaDocument; isSumario: boolean } | { type: 'skip' } | { type: 'none' };

async function checkAndMergeComplementary(newDoc: PartialJurisprudenciaDocument): Promise<ComplementaryCheck> {
    if (!newDoc.Data || !newDoc["Número de Processo"]) return { type: 'none' };

    const newHasSumario = (newDoc["Sumário Não Anonimizado"] || "").length > 0;
    const newHasTexto = (newDoc["Texto Não Anonimizado"] || "").length > 0;

    // Only relevant when this doc has exactly one of sumário or texto
    if (newHasSumario === newHasTexto) return { type: 'none' };

    const r = await esClient.search<JurisprudenciaDocument>({
        index: JurisprudenciaVersion,
        query: {
            bool: {
                must: [
                    { term: { "Data": newDoc.Data } },
                    { term: { "Número de Processo": newDoc["Número de Processo"] } }
                ]
            }
        },
        _source: true,
        size: 10
    });

    // Meio Processual values of the new doc, excluding the "Sumário" type marker
    const newMeios = new Set((newDoc["Meio Processual"]?.Original ?? []).filter(m => m !== "Sumário"));

    for (const hit of r.hits.hits) {
        if (!hit._source || !hit._id) continue;
        const existing = hit._source;

        // Match Meio Processual ignoring the "Sumário" marker on either side
        const existingMeios = (existing["Meio Processual"]?.Original ?? []).filter(m => m !== "Sumário");
        if (newMeios.size > 0 && existingMeios.length > 0) {
            if (!existingMeios.some(m => newMeios.has(m))) continue;
        }

        const existingHasSumario = (existing["Sumário Não Anonimizado"] || "").length > 0;
        const existingHasTexto = (existing["Texto Não Anonimizado"] || "").length > 0;

        // Already a complete doc — this file was already merged in a previous run
        if (existingHasSumario && existingHasTexto) return { type: 'skip' };

        // Complementary: one has sumário, the other has texto
        if ((newHasSumario && !existingHasSumario && existingHasTexto) ||
            (newHasTexto && !existingHasTexto && existingHasSumario)) {
            await mergeIntoDocument(hit._id, existing, newDoc);
            return { type: 'merged', existingDoc: existing, isSumario: newHasSumario };
        }
    }

    return { type: 'none' };
}

async function mergeIntoDocument(existingId: string, existing: JurisprudenciaDocument, newDoc: PartialJurisprudenciaDocument): Promise<void> {
    const update: PartialJurisprudenciaDocument = {};

    if (!(existing["Sumário Não Anonimizado"] || "").length && newDoc["Sumário Não Anonimizado"]) {
        update["Sumário Não Anonimizado"] = newDoc["Sumário Não Anonimizado"];
    }
    if (!(existing["Texto Não Anonimizado"] || "").length && newDoc["Texto Não Anonimizado"]) {
        update["Texto Não Anonimizado"] = newDoc["Texto Não Anonimizado"];
    }

    // Merge CONTENT without duplicates
    const newContent = newDoc.CONTENT?.filter(c => !existing.CONTENT?.includes(c)) || [];
    if (newContent.length > 0) {
        update.CONTENT = [...(existing.CONTENT || []), ...newContent];
    }

    // If the existing doc was the sumário doc, strip "Sumário" from Meio Processual
    const existingMeios = existing["Meio Processual"]?.Original ?? [];
    if (existingMeios.includes("Sumário")) {
        const cleaned = existingMeios.filter(m => m !== "Sumário");
        update["Meio Processual"] = { Index: cleaned, Original: cleaned, Show: cleaned };
    }

    update.HASH = calculateHASH({
        Original: existing.Original,
        "Número de Processo": existing["Número de Processo"],
        Data: existing.Data,
        "Meio Processual": update["Meio Processual"] ?? existing["Meio Processual"],
        "Sumário": "",
        "Texto": "",
        "Sumário Não Anonimizado": update["Sumário Não Anonimizado"] ?? existing["Sumário Não Anonimizado"],
        "Texto Não Anonimizado": update["Texto Não Anonimizado"] ?? existing["Texto Não Anonimizado"],
    });

    await esClient.update({
        index: JurisprudenciaVersion,
        id: existingId,
        body: { doc: update }
    });

    console.log(`Merged ${newDoc.Sumário ? "Sumário" : "Texto"} from ${newDoc.URL} into existing document ${existingId}`);
}

export async function updateDrives() {
    const last_update: FilesystemUpdate = loadLastFilesystemUpdate("STJ (Sharepoint)");
    const drive_id_names = await getDrivesIdNames();

    for (const [drive_name, drive_id] of Object.entries(drive_id_names)) {
        await updateDrive(drive_name, drive_id, last_update);
    }

    await processReintroductions(drive_id_names);
}

async function processReintroductions(drive_id_names: Record<string, string>): Promise<void> {
    const markers = loadPendingReintroductions();
    if (markers.length === 0) return;

    console.log(`Processing ${markers.length} pending reintroduction(s)...`);

    // Group markers by (drive_id, parent_sharepoint_id) to avoid scanning the same folder twice
    const foldersToScan = new Map<string, { drive_name: string; drive_id: string; parent_sharepoint_id: string; uuids: string[] }>();
    for (const marker of markers) {
        // Only process markers for drives we know about
        if (!Object.values(drive_id_names).includes(marker.drive_id)) {
            console.warn(`processReintroductions: unknown drive_id ${marker.drive_id} for UUID ${marker.uuid}, skipping`);
            clearReintroductionMarker(marker.uuid);
            continue;
        }
        const key = `${marker.drive_id}:${marker.parent_sharepoint_id}`;
        if (!foldersToScan.has(key)) {
            foldersToScan.set(key, { drive_name: marker.drive_name, drive_id: marker.drive_id, parent_sharepoint_id: marker.parent_sharepoint_id, uuids: [] });
        }
        foldersToScan.get(key)!.uuids.push(marker.uuid);
    }

    const update: FilesystemUpdate = { updateSource: "STJ (Sharepoint)", date_start: new Date(), file_errors: [] };
    const retrievable_metadata_tables: Record<string, any> = {};

    for (const { drive_name, drive_id, parent_sharepoint_id, uuids } of foldersToScan.values()) {
        console.log(`processReintroductions: scanning folder ${parent_sharepoint_id} in drive ${drive_name}`);
        await scanFolderForMissingFiles(drive_name, drive_id, parent_sharepoint_id, retrievable_metadata_tables, update);
        for (const uuid of uuids) clearReintroductionMarker(uuid);
    }

    if ((update.created_num ?? 0) > 0 || update.file_errors.length > 0) {
        terminateUpdate(update, `Reintroductions processed.`, "STJ (Sharepoint)");
    }
}

// Check if a document for this process/date/tipo already exists in ES with content
async function isAlreadyIntroduced(processNumber: string, data: string, isSumario: boolean): Promise<boolean> {
    const r = await esClient.search<JurisprudenciaDocument>({
        index: JurisprudenciaVersion,
        query: { bool: { must: [{ term: { "Data": data } }, { term: { "Número de Processo": processNumber } }] } },
        _source: ["Sumário Não Anonimizado", "Texto Não Anonimizado"],
        size: 10
    });
    for (const hit of r.hits.hits) {
        if (!hit._source) continue;
        if (isSumario && (hit._source["Sumário Não Anonimizado"] || "").length > 0) return true;
        if (!isSumario && (hit._source["Texto Não Anonimizado"] || "").length > 0) return true;
    }
    return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
        )
    ]);
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

// Core processing pipeline for a single drive item. Throws on unrecoverable error.
async function processFileItem(
    drive_item: any,
    drive_name: string,
    drive_id: string,
    retrievable_metadata_tables: Record<string, Retrievable_Metadata_Table>,
    update: FilesystemUpdate
): Promise<void> {
    const sharepoint_metadata: Sharepoint_Metadata = readSharepoint_Metadata(drive_item, drive_name, drive_id);
    const creation_date: Date = new Date();
    const last_update_date: Date = creation_date;
    const date_area_section: Date_Area_Section = getDateAreaSection(sharepoint_metadata);

    const folderKey = path.dirname(sharepoint_metadata.sharepoint_path_rel);
    if (!(folderKey in retrievable_metadata_tables)) {
        retrievable_metadata_tables[folderKey] = await withTimeout(
            retrieveSharepointTable(sharepoint_metadata),
            60_000,
            `retrieveSharepointTable for ${folderKey}`
        );
    }

    const retrievable_metadata: Retrievable_Metadata = getRetrievableMetadata(retrievable_metadata_tables[folderKey], sharepoint_metadata);
    if (normalizeString(path.basename(sharepoint_metadata.sharepoint_path_rel)).includes(normalizeString("Sumário"))) {
        retrievable_metadata.process_mean.push("Sumário");
    }

    const content: ContentType[] = await withTimeout(
        retrieveSharepointContent(sharepoint_metadata),
        60_000,
        `retrieveSharepointContent for ${sharepoint_metadata.sharepoint_url}`
    );

    let contentHash: string | undefined;
    try {
        contentHash = crypto.createHash("sha256").update(content[0].data).digest("hex");
        const cached = loadCachedNlpFromDetalhes(sharepoint_metadata.sharepoint_path_rel, contentHash);
        let nlp_json: string | undefined;
        if (cached) {
            console.log(`NLP cache hit for ${sharepoint_metadata.sharepoint_url}`);
            nlp_json = cached;
        } else {
            nlp_json = await withTimeout(
                convertAndSaveNLP(content[0]),
                120_000,
                `convertAndSaveNLP for ${sharepoint_metadata.sharepoint_url}`
            );
        }
        if (nlp_json) {
            content.push({ data: Buffer.from(nlp_json, "utf-8"), extension: "json" });
        }
    } catch (err: unknown) {
        console.warn(`NLP/conversion failed for ${sharepoint_metadata.sharepoint_url}, continuing without:`, err instanceof Error ? err.message : err);
    }

    const jurisprudencia_document_original: PartialJurisprudenciaDocument = await createJurisprudenciaDocument(retrievable_metadata, content, date_area_section, sharepoint_metadata);

    const file_path: string = generateFilePath(jurisprudencia_document_original);
    const jurisprudencia_document: string = jurisprudencia_document_original.UUID || "";

    const filesystem_document: FilesystemDocument = {
        creation_date,
        last_update_date,
        jurisprudencia_document,
        content,
        file_path,
        sharepoint_metadata,
        contentHash,
    };

    const complementaryResult = await checkAndMergeComplementary(jurisprudencia_document_original);

    if (complementaryResult.type === 'skip') {
        console.log(`Skipping ${sharepoint_metadata.sharepoint_url}: complete document already exists for this process/date/meio`);
        return;
    }

    if (complementaryResult.type === 'merged') {
        const mainContent = content.find(c => c.extension !== "json");
        if (mainContent) {
            writeContentToDocument(complementaryResult.existingDoc, mainContent, complementaryResult.isSumario);
        }
        addFileToUpdate(update, filesystem_document);
        return;
    }

    let r: estypes.WriteResponseBase | undefined = undefined;
    try {
        r = await updateJurisDocument(jurisprudencia_document_original);
    } catch (err: unknown) {
        console.error("Couldn't save juris document");
        writeFilesystemDocument(filesystem_document);
        addFileToUpdate(update, filesystem_document);
        return;
    }

    if (r?.result === "created") {
        writeFilesystemDocument(filesystem_document);
        addFileToUpdate(update, filesystem_document);
    } else if (filesystem_document.file_path) {
        const detalhesPath = `${ROOT_PATH}${FILESYSTEM_PATH}${filesystem_document.file_path}/${DETAILS_NAME}.json`;
        if (!fs.existsSync(detalhesPath)) {
            console.log(`Restoring missing filesystem entry for ${filesystem_document.file_path}`);
            writeFilesystemDocument(filesystem_document);
            addFileToUpdate(update, filesystem_document);
        }
    }
}

// After delta processing: scan each folder that appeared in the delta and process
// any file not yet introduced, to catch files whose table arrived after them.
async function scanFolderForMissingFiles(
    drive_name: string,
    drive_id: string,
    parentFolderId: string,
    retrievable_metadata_tables: Record<string, Retrievable_Metadata_Table>,
    update: FilesystemUpdate
): Promise<void> {
    const tabelaRegex = /.*tabela.*\.pdf$/i;

    let folderChildren: any;
    try {
        folderChildren = await withTimeout(
            client.api(`/drives/${drive_id}/items/${parentFolderId}/children`).get(),
            30_000,
            `get children for folder ${parentFolderId}`
        );
    } catch (err) {
        console.error(`scanFolder: failed to get children for folder ${parentFolderId}:`, err instanceof Error ? err.message : err);
        return;
    }

    for (const item of folderChildren.value ?? []) {
        if (!item.file) continue;
        if (tabelaRegex.test((item.name ?? "").toLowerCase())) continue;

        try {
            const sharepoint_metadata = readSharepoint_Metadata(item, drive_name, drive_id);
            const date_area_section = getDateAreaSection(sharepoint_metadata);

            const folderKey = path.dirname(sharepoint_metadata.sharepoint_path_rel);
            if (!(folderKey in retrievable_metadata_tables)) {
                retrievable_metadata_tables[folderKey] = await withTimeout(
                    retrieveSharepointTable(sharepoint_metadata),
                    60_000,
                    `retrieveSharepointTable for ${folderKey}`
                );
            }

            const retrievable_metadata = getRetrievableMetadata(retrievable_metadata_tables[folderKey], sharepoint_metadata);
            const isSumario = normalizeString(path.basename(sharepoint_metadata.sharepoint_path_rel)).includes(normalizeString("Sumário"));
            const formattedDate = Intl.DateTimeFormat("pt-PT").format(date_area_section.file_date);

            if (await isAlreadyIntroduced(retrievable_metadata.process_number, formattedDate, isSumario)) {
                continue;
            }

            console.log(`scanFolder: introducing missing file ${sharepoint_metadata.sharepoint_url}`);
            await processFileItem(item, drive_name, drive_id, retrievable_metadata_tables, update);
        } catch (err: unknown) {
            if (err instanceof Error) {
                logDocumentProcessingError(update, `scanFolder: Error processing ${item?.name ?? "unknown"}: ${err.message}`);
            }
        }
    }
}

async function updateDrive(drive_name: string, drive_id: string, lastUpdate: FilesystemUpdate): Promise<void> {
    console.log(drive_name);
    let update: FilesystemUpdate = { updateSource: "STJ (Sharepoint)", date_start: new Date(), file_errors: [] };

    process.once("SIGINT", () => {
        terminateUpdate(update, `Update terminated by user.`, "STJ (Sharepoint)").then(() => process.exit(0));
    });

    let next = lastUpdate.next_link || lastUpdate.delta_link || `/sites/${encodeURIComponent(site_id)}/drives/${encodeURIComponent(drive_id)}/root/delta`;
    let i = 0;

    // Shared table cache across all pages — avoids re-fetching the same table PDF
    const retrievable_metadata_tables: Record<string, Retrievable_Metadata_Table> = {};
    // Folders that appeared in the delta — scanned afterwards for missing files
    const foldersToScan = new Set<string>();

    while (next) {
        const normalized = normalizeGraphUrlToPath(next);
        const page_of_documents = await withTimeout(
            client.api(normalized).get(),
            60_000,
            `delta page ${normalized}`
        );

        update.delta_link = page_of_documents["@odata.deltaLink"];
        update.next_link = page_of_documents["@odata.nextLink"];

        for (const drive_item of page_of_documents.value ?? []) {
            if (drive_item.deleted) continue;
            if (drive_item.folder) continue;
            if (!drive_item.file) continue;

            // Track folder before try/catch so even tabela files mark the folder
            if (drive_item.parentReference?.id) {
                foldersToScan.add(drive_item.parentReference.id);
            }

            i++;
            try {
                await processFileItem(drive_item, drive_name, drive_id, retrievable_metadata_tables, update);
            } catch (err: unknown) {
                if (err instanceof Error) {
                    const file_name = (drive_item?.parentReference?.path ?? "") + "/" + (drive_item?.name ?? "");
                    logDocumentProcessingError(update, `Error processing file ${file_name} (#${i}) in drive ${drive_name}: ${err.message}`);
                }
            }
        }

        console.log(`Files seen so far: ${i}`);

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

    // Post-delta folder scan: process any files in delta-touched folders that weren't introduced yet
    console.log(`Scanning ${foldersToScan.size} folder(s) for missing files...`);
    for (const parentFolderId of foldersToScan) {
        await scanFolderForMissingFiles(drive_name, drive_id, parentFolderId, retrievable_metadata_tables, update);
    }

    terminateUpdate(update, `Drive ${drive_name} updated.`, "STJ (Sharepoint)");
}

function getDateAreaSection(sharepoint_metadata: Sharepoint_Metadata): Date_Area_Section {
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
            section = SECTIONTOSECTION[key];
            area = SECTIONTOAREA[key];
            break;
        }
    }
    if (!(file_date && area && section)) {
        throw new Error("Date ou Area ou Secção não puderam ser extraidas do caminho do sharepoint.");
    }

    return { file_date, area, section };
}

type Row = Record<string, string>;

async function retrieveSharepointTable(sharepoint_metadata: Sharepoint_Metadata): Promise<Retrievable_Metadata_Table> {
    const response = await client.api(`/drives/${sharepoint_metadata.drive_id}/items/${sharepoint_metadata.parent_sharepoint_id}/children`).get();

    const tabelaRegex = /.*tabela.*\.pdf$/i;
    const matchingFile = response.value.find((item: any) => item.file && tabelaRegex.test(item.name.toLowerCase()));

    if (!matchingFile) {
        return {};
    }

    const webStream = await client.api(`/drives/${sharepoint_metadata.drive_id}/items/${matchingFile.id}/content`).get();

    const reader = webStream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }

    const fileContent = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    const parsed_rows = await parseMetadataTable(fileContent);
    const table: Retrievable_Metadata_Table = parsed_rows.reduce((acc, row) => {
        const key = row["Processo"];

        if (!key) return acc;

        acc[key] = { process_number: row["Processo"], judge: row["Relator"], process_mean: [row["Espécie"]], decision: row["Decisão"] };
        return acc;
    }, {} as Retrievable_Metadata_Table);
    return table;
}

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
                reject(new Error(`Failed to parse JSON from Python stdout. Error: ${(err as Error).message}\nStdout: ${stdout.slice(0, 2000)}\nStderr: ${stderr}`));
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
    const original_file_name: string = path.basename(sharepoint_metadata.sharepoint_path_rel).replace(/-/g, "/");
    const matchedKey = Object.keys(retrievable_metadata_table).find((k) => original_file_name.includes(k.replace(/-/g, "/")));
    if (!matchedKey) {
        const file_name = path.basename(sharepoint_metadata.sharepoint_path_rel, path.extname(sharepoint_metadata.sharepoint_path_rel));
        return { process_number: file_name, judge: "", process_mean: [], decision: "" };
    }
    return retrievable_metadata_table[matchedKey];
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
    const sharepoint_path = drive_item.parentReference.path + "/" + drive_item.name;
    const sharepoint_path_rel = generateRelPath(sharepoint_path, drive_id, drive_name);
    const sharepoint_url = drive_item.webUrl;
    const xor_hash: string | undefined = drive_item.file.hashes.quickXorHash;
    const extensions: Supported_Content_Extensions[] = [getSupportedExtension(drive_item.name)];

    return {
        drive_name,
        drive_id,
        sharepoint_id,
        parent_sharepoint_id,
        sharepoint_path,
        sharepoint_path_rel,
        sharepoint_url,
        extensions,
        xor_hash
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
    if (!sharepoint_path) return `/${drive_name}`;

    const marker = `/drives/${drive_id}`;
    const start = sharepoint_path.indexOf(marker);

    let rest = start >= 0 ? sharepoint_path.slice(start + marker.length) : sharepoint_path;

    rest = rest.replace(/^\/drive\/root:|^\/root:|^:/, "");

    if (!rest.startsWith("/")) rest = "/" + rest;

    return `/${drive_name}${rest}`;
}

async function retrieveSharepointContent(sharepoint_metadata: Sharepoint_Metadata): Promise<ContentType[]> {
    let contents: ContentType[] = [];
    for (const extension of sharepoint_metadata.extensions) {
        const webStream = await client.api(`/drives/${sharepoint_metadata.drive_id}/items/${sharepoint_metadata.sharepoint_id}/content`).get();

        const reader = webStream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        contents.push({ extension: extension, data: Buffer.concat(chunks.map((c) => Buffer.from(c))) });
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

function normalizeString(str: string): string {
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

async function convertAndSaveNLP(content: ContentType): Promise<string | undefined> {
    try {
        let formData = new FormData();
        const uint8Array = new Uint8Array(content.data);
        const blob = new Blob([uint8Array]);
        formData.append("file", blob, `Temp_file.${content.extension}`);
        console.log(process.env.ANONIMIZADOR_URL);
        const response = await fetch(`${process.env.ANONIMIZADOR_URL}/api/file_to_json`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Conversion failed: ${errorText}`);
        }

        const result = await response.json();

        console.log("NLP results saved successfully");

        return JSON.stringify(result.nlp, null, 2);
    } catch (error) {
        console.error("Error:", error);
    }
}
