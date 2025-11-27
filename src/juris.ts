import { Client } from "@elastic/elasticsearch";
import { FileSystemDocument, FileSystemUpdate, loadContentFile, loadMetadataFile } from "./filesystem";
import fs from "fs";
import { calculateHASH, calculateUUID, JurisprudenciaDocument, JurisprudenciaVersion, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";
import { IndexResponse, WriteResponseBase } from "@elastic/elasticsearch/lib/api/types";
import { client } from "./client";
import { create } from "domain";
import path from "path";
import mammoth from "mammoth";
import { DescritorOficial } from "./descritores";
import { isSymbolObject } from "util/types";

export async function addJurisprudencia(update: FileSystemUpdate, root_path: string, client: Client) {
    let juris: IndexResponse[] = [];
    for (const document_path of update.created) {
        const response = await introduceJurisprudencia(root_path, document_path.system_path, client);
        if (response)
            juris.push(response);
    }
    return juris;
}

async function introduceJurisprudencia(root_path: string, document_path: string, client: Client): Promise<IndexResponse | void> {
    const content_path = loadContentFile(root_path, document_path);
    const metadata = loadMetadataFile(root_path, document_path);
    if (!content_path || !metadata)
        return;
    let r: WriteResponseBase | void;

    r = await indexElasticSearchFromFilesystem(metadata, content_path, client);

    return r;

}

async function indexElasticSearchFromFilesystem(document: FileSystemDocument, content_path: string, client: Client): Promise<IndexResponse | void> {
    const resolved = path.resolve(content_path);
    const buffer = fs.readFileSync(resolved);

    const result = await mammoth.extractRawText({ buffer });

    const text = result.value || "";

    const content = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const obj = createElasticSearchDocumentFromFileSystem(document, content);
    if (obj) {
        return client.index({
            index: JurisprudenciaVersion,
            body: obj
        })
    }
}

function createElasticSearchDocumentFromFileSystem(document: FileSystemDocument, content: string[]): Partial<JurisprudenciaDocument> | undefined {
    if (!document.metadata)
        return;
    let Original: JurisprudenciaDocument["Original"] = {};
    let CONTENT: JurisprudenciaDocument["CONTENT"] = content;
    let numProc: JurisprudenciaDocument["Número de Processo"] = document.metadata.process_number ?? document.original_name;

    let Data: JurisprudenciaDocument["Data"] = document.metadata?.date?.toISOString() || "01/01/1900";

    let origin = document.sharepoint_id ? "STJ (Sharepoint)" : "Unknown";
    let obj: PartialJurisprudenciaDocument = {
        "Original": Original,
        "CONTENT": CONTENT,
        "Data": Data,
        "Número de Processo": numProc,
        "Fonte": origin,
        "URL": document.sharepoint_url,
        "Jurisprudência": { Index: ["Simples"], Original: ["Simples"], Show: ["Simples"] },
        "STATE": "privado",
    }

    obj.Texto = content.map(line => `<p><font>${line}</font><br>`).join('');
    if (document.metadata.descriptors && document.metadata.descriptors.length > 0) {
        obj.Descritores = {
            Index: document.metadata.descriptors.map(desc => DescritorOficial[desc]),
            Original: document.metadata.descriptors,
            Show: document.metadata.descriptors.map(desc => DescritorOficial[desc])
        }
    }
    if (document.metadata.area && document.metadata.area.length > 0) {
        obj.Área = { Index: [document.metadata.area], Original: [document.metadata.area], Show: [document.metadata.area] };
    }
    if (document.metadata.section && document.metadata.section.length > 0) {
        obj.Secção = { Index: [document.metadata.section], Original: [document.metadata.section], Show: [document.metadata.section] };
    }
    if (document.metadata.judge && document.metadata.judge.length > 0) {
        obj["Relator Nome Profissional"] = { Index: [document.metadata.judge], Original: [document.metadata.judge], Show: [document.metadata.judge] };
    }
    if (document.metadata.process_mean && document.metadata.process_mean.length > 0) {
        obj["Meio Processual"] = { Index: [document.metadata.process_mean], Original: [document.metadata.process_mean], Show: [document.metadata.process_mean] };
    }
    if (document.metadata.decision && document.metadata.decision.length > 0) {
        obj["Decisão"] = { Index: [document.metadata.decision], Original: [document.metadata.decision], Show: [document.metadata.decision] };
    }

    obj["HASH"] = calculateHASH({
        ...obj,
        Original: obj.Original,
        "Número de Processo": obj["Número de Processo"] || "",
        Sumário: obj.Sumário || "",
        Texto: obj.Texto || "",
    })

    obj["UUID"] = calculateUUID(obj["HASH"])
    return obj;
}


