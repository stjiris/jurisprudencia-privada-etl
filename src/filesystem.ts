import { calculateHASH, calculateUUID, JurisprudenciaDocument, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";
import fs from "fs";
import dotenv from 'dotenv';
import path from "path";
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from "mammoth";
import { DescritorOficial } from "./descritores";

dotenv.config();
export const ROOT_PATH = process.env['LOCAL_ROOT'] || 'results';
const FILESYSTEM_PATH = `/FileSystem`
const SHAREPOINT_COPY_PATH = `/Sharepoint`
const DETAILS_NAME = "Detalhes"
const ORIGINAL_NAME = "Original"

const LOGS_PATH = "/Updates"
const UPDATE_DIR = `${ROOT_PATH}${LOGS_PATH}`;

export type Sharepoint_Metadata = {
    drive_name: string,
    drive_id: string,
    sharepoint_id: string,
    parent_sharepoint_id: string,
    sharepoint_path: string,
    sharepoint_path_rel: string,
    sharepoint_url: string,
    extensions: Supported_Content_Extensions[],
    xor_hash?: string,
}
export type Retrievable_Metadata = { process_number: string, judge: string, process_mean: string, decision: string, descriptors?: string[] };
export type Date_Area_Section = { file_date: Date, area: string, section: string };
export const SUPPORTED_EXTENSIONS = ["txt", "pdf", "docx"] as const;
export type Supported_Content_Extensions = typeof SUPPORTED_EXTENSIONS[number];

export type ContentType = {
    extension: Supported_Content_Extensions;
    data: Buffer;
};
export type FilesystemDocument = {
    creation_date: Date,
    last_update_date: Date,
    jurisprudencia_document: PartialJurisprudenciaDocument,
    file_path: string,
    sharepoint_metadata?: Sharepoint_Metadata
    content?: ContentType[],
}

export const UpdateSources = ["STJ (Sharepoint)", "Juris"] as const;
export type SupportedUpdateSources = typeof UpdateSources[number];

export type FilesystemUpdate = {
    updateSource: SupportedUpdateSources,
    date_start: Date,
    file_errors: string[],
    date_end?: Date,
    created_num?: number, created?: string[],
    deleted_num?: number, deleted?: string[],
    updated_num?: number, updated?: string[],
    next_link?: string, delta_link?: string
};

export function isSupportedExtension(ext: string): ext is Supported_Content_Extensions {
    return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
}

export function writeFilesystemDocument(filesystem_document: FilesystemDocument): void {
    if (!filesystem_document.content)
        return

    const safe = {
        ...filesystem_document,
        content: filesystem_document.content?.map(({ extension }) => ({ extension }))
    };

    const content: ContentType[] = filesystem_document.content

    if (filesystem_document.file_path) {
        // make filesystem paths
        const filesystem_dir_path = `${ROOT_PATH}${FILESYSTEM_PATH}${filesystem_document.file_path}`;
        const filesystem_metadata_path = `${filesystem_dir_path}/${DETAILS_NAME}.json`;
        fs.mkdirSync(filesystem_dir_path, { recursive: true });
        fs.writeFileSync(filesystem_metadata_path, JSON.stringify(safe, null, 2), { encoding: "utf-8" });
        for (const content_i of content) {
            const filesystem_original_path = `${filesystem_dir_path}/${ORIGINAL_NAME}.${content_i.extension}`;
            fs.writeFileSync(filesystem_original_path, content_i.data, { encoding: "utf-8" });
        }

        // make metadata copy on filesystem copy
        if (filesystem_document.sharepoint_metadata) {
            const filesystem_sharepoint_dir_path = `${ROOT_PATH}${SHAREPOINT_COPY_PATH}${filesystem_document.sharepoint_metadata.sharepoint_path_rel}`;
            const filesystem_sharepoint_path = `${filesystem_sharepoint_dir_path}/${DETAILS_NAME}.json`;
            fs.mkdirSync(filesystem_sharepoint_dir_path, { recursive: true });
            fs.writeFileSync(filesystem_sharepoint_path, JSON.stringify(safe, null, 2), { encoding: "utf-8" });
        }
    } else {
        if (filesystem_document.sharepoint_metadata) {
            const filesystem_sharepoint_dir_path = `${ROOT_PATH}${SHAREPOINT_COPY_PATH}${filesystem_document.sharepoint_metadata.sharepoint_path_rel}`;
            const filesystem_sharepoint_path = `${filesystem_sharepoint_dir_path}/${DETAILS_NAME}.json`;
            fs.mkdirSync(filesystem_sharepoint_dir_path, { recursive: true });
            fs.writeFileSync(filesystem_sharepoint_path, JSON.stringify(safe, null, 2), { encoding: "utf-8" });
            for (const content_i of content) {
                const filesystem_original_path = `${filesystem_sharepoint_dir_path}/${ORIGINAL_NAME}.${content_i.extension}`;
                fs.writeFileSync(filesystem_original_path, content_i.data, { encoding: "utf-8" });
            }
        }
    }
}

export function addFileToUpdate(update: FilesystemUpdate, filesystem_document: FilesystemDocument): void {
    if (!filesystem_document.file_path) {
        throw new Error("File to be added to update doesn't have a system path.");
    }
    if (!update.created) {
        update.created = [];
    }
    if (!update.created_num) {
        update.created_num = 0;
    }
    update.created_num += 1;
    update.created.push(filesystem_document.file_path);
}

export function loadFilesystemDocument(jsonPath: string): FilesystemDocument {
    const jsonString = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(jsonString);

    return {
        ...parsed,
        creation_date: new Date(parsed.creation_date),
        last_update_date: new Date(parsed.last_update_date),
        content: parsed.content?.map((item: any) => ({
            extension: item.extension,
            data: Buffer.from([])
        }))
    };
}

export function writeFilesystemUpdate(update: FilesystemUpdate): void {
    update.date_end = new Date();

    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const updates_file_path = `${UPDATE_DIR}/log_${formatUpdateDate(update.date_end)}.json`;

    const drive_dir_path = `${UPDATE_DIR}/All`
    fs.mkdirSync(drive_dir_path, { recursive: true });
    const drive_file_path = `${drive_dir_path}/log_${formatUpdateDate(update.date_end)}.json`;

    removeOldUpdate(UPDATE_DIR);

    fs.writeFileSync(drive_file_path, JSON.stringify(update, null, 2), { encoding: "utf-8" });
    fs.writeFileSync(updates_file_path, JSON.stringify(update, null, 2), { encoding: "utf-8" });
}

export function loadLastFilesystemUpdate(): FilesystemUpdate {
    const empty_update: FilesystemUpdate = {
        updateSource: "STJ (Sharepoint)",
        file_errors: [],
        date_start: new Date()
    }

    if (!fs.existsSync(UPDATE_DIR))
        return empty_update;

    const files = fs.readdirSync(UPDATE_DIR);
    for (const file of files) {
        const fullPath = path.join(UPDATE_DIR, file);
        if (fs.statSync(fullPath).isFile() && file.toLowerCase().includes("log")) {
            const jsonString = fs.readFileSync(fullPath, 'utf-8');
            const parsed: FilesystemUpdate = JSON.parse(jsonString);
            return parsed;
        }
    }

    return empty_update;
}

export function logDocumentProcessingError(update: FilesystemUpdate, err: string) {
    update.file_errors.push(err);
}

export function generateFilePath(date_area_section: Date_Area_Section, retrievable_metadata: Retrievable_Metadata): string {
    return `/${date_area_section.area}/${date_area_section.file_date.getFullYear()}/${date_area_section.file_date.getMonth() + 1}/${date_area_section.file_date.getDate()}/${retrievable_metadata.process_number.replace("/", "-")}`
}

function formatUpdateDate(d: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function removeOldUpdate(folderPath: string) {
    if (!fs.existsSync(folderPath))
        return;

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
        const fullPath = path.join(folderPath, file);
        if (fs.statSync(fullPath).isFile() && file.toLowerCase().includes("log")) {
            fs.unlinkSync(fullPath);
            console.log(`Deleted: ${fullPath} `);
        }
    }
}

export async function createJurisprudenciaDocument(retrievable_Metadata: Retrievable_Metadata, contents: ContentType[], date_area_section: Date_Area_Section, sharepoint_metadata?: Sharepoint_Metadata): Promise<PartialJurisprudenciaDocument> {
    if (!retrievable_Metadata) {
        throw new Error("Missing metadata.");
    }
    const content = await extractContent(contents);
    const url = sharepoint_metadata ? sharepoint_metadata.sharepoint_url : "";

    let Original: JurisprudenciaDocument["Original"] = {};
    let CONTENT: JurisprudenciaDocument["CONTENT"] = content;
    let numProc: JurisprudenciaDocument["Número de Processo"] = retrievable_Metadata.process_number;
    let Data: JurisprudenciaDocument["Data"] = Intl.DateTimeFormat("pt-PT").format(date_area_section.file_date);
    let origin: SupportedUpdateSources = "STJ (Sharepoint)";

    Original["Decisão Texto Integral"] = content.map(line => `<p><font>${line}</font><br>`).join('');
    Original["Data"] = Data;
    Original["Número de Processo"] = numProc;
    Original["Fonte"] = origin;
    Original["URL"] = url;
    Original["Jurisprudência"] = "Simples";

    let obj: PartialJurisprudenciaDocument = {
        "Original": Original,
        "CONTENT": CONTENT,
        "Data": Data,
        "Número de Processo": numProc,
        "Fonte": origin,
        "URL": url,
        "Jurisprudência": { Index: ["Simples"], Original: ["Simples"], Show: ["Simples"] },
        "STATE": "importação",
    }
    obj.Sumário = "";
    obj.Texto = content.map(line => `<p><font>${line}</font><br>`).join('');
    if (retrievable_Metadata.descriptors && retrievable_Metadata.descriptors.length > 0) {
        obj.Descritores = {
            Index: retrievable_Metadata.descriptors.map(desc => DescritorOficial[desc]),
            Original: retrievable_Metadata.descriptors,
            Show: retrievable_Metadata.descriptors.map(desc => DescritorOficial[desc])
        }
    }
    if (date_area_section.area && date_area_section.area.length > 0) {
        obj.Área = { Index: [date_area_section.area], Original: [date_area_section.area], Show: [date_area_section.area] };
    }
    if (date_area_section.section && date_area_section.section.length > 0) {
        obj.Secção = { Index: [date_area_section.section], Original: [date_area_section.section], Show: [date_area_section.section] };
    }
    if (retrievable_Metadata.judge && retrievable_Metadata.judge.length > 0) {
        obj["Relator Nome Profissional"] = { Index: [retrievable_Metadata.judge], Original: [retrievable_Metadata.judge], Show: [retrievable_Metadata.judge] };
    }
    if (retrievable_Metadata.process_mean && retrievable_Metadata.process_mean.length > 0) {
        obj["Meio Processual"] = { Index: [retrievable_Metadata.process_mean], Original: [retrievable_Metadata.process_mean], Show: [retrievable_Metadata.process_mean] };
    }
    if (retrievable_Metadata.decision && retrievable_Metadata.decision.length > 0) {
        obj["Decisão"] = { Index: [retrievable_Metadata.decision], Original: [retrievable_Metadata.decision], Show: [retrievable_Metadata.decision] };
    }

    obj["HASH"] = calculateHASH({
        ...obj,
        Original: obj.Original,
        "Número de Processo": obj["Número de Processo"] || "",
        Sumário: obj.Sumário || "",
        Texto: obj.Texto || "",
    })

    obj["UUID"] = calculateUUID(obj["HASH"]);
    return obj;
}

async function extractContent(contents: ContentType[]): Promise<string[]> {
    for (const content of contents) {
        if (content.extension === "txt") {
            return content.data.toString('utf-8').split(/\r?\n/).filter(line => line.trim().length > 0);
        }
        if (content.extension === "pdf") {
            return await pdfToLines(content.data);
        }
        if (content.extension === "docx") {
            return await docxToLines(content.data);
        }
    }
    throw new Error("Contents are not a supported format.");
}

async function pdfToLines(buffer: Buffer): Promise<string[]> {
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array, verbosity: 0 });
    const pdf = await loadingTask.promise;

    const allLines: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
            .map((item: any) => item.str)
            .join('\n');

        const lines = pageText.split('\n').filter(line => line.trim().length > 0);
        allLines.push(...lines);
    }

    return allLines;
}

async function docxToLines(buffer: Buffer): Promise<string[]> {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || "";

    const content = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    return content;
}

export async function hasSelectableText(buffer: Buffer): Promise<boolean> {
    try {
        const uint8Array = new Uint8Array(buffer);
        const loadingTask = pdfjsLib.getDocument({
            data: uint8Array,
            standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
        });
        const pdf = await loadingTask.promise;

        const pagesToCheck = Math.min(3, pdf.numPages);

        for (let i = 1; i <= pagesToCheck; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            if (textContent.items.some((item: any) => item.str?.trim().length > 0)) {
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error('Error reading PDF:', error);
        return false;
    }
}