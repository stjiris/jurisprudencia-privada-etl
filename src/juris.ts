import { calculateHASH, isJurisprudenciaDocumentContentKey, isJurisprudenciaDocumentDateKey, isJurisprudenciaDocumentExactKey, isJurisprudenciaDocumentGenericKey, isJurisprudenciaDocumentHashKey, isJurisprudenciaDocumentObjectKey, isJurisprudenciaDocumentStateKey, isJurisprudenciaDocumentTextKey, JurisprudenciaDocument, JurisprudenciaDocumentDateKey, JurisprudenciaDocumentExactKey, JurisprudenciaDocumentKeys, JurisprudenciaVersion, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";
import { Client, estypes } from "@elastic/elasticsearch";
import { FilesystemDocument } from "@stjiris/filesystem-lib";
import { createJurisprudenciaDocumentFromURL } from "./dgsi/parser.js";
import { conflicts } from "./report/report.js";

export const client = new Client({ node: process.env.ES_URL || "http://localhost:9200", auth: { username: process.env.ES_USER || "", password: process.env.ES_PASS || "" } });

export async function updateJurisDocument(filesystem_document: FilesystemDocument): Promise<estypes.IndexResponse | undefined> {
    if (!filesystem_document.jurisprudencia_document.UUID)
        return;
    return client.index({
        index: JurisprudenciaVersion,
        id: filesystem_document.jurisprudencia_document.UUID,
        body: filesystem_document.jurisprudencia_document
    });
}

export async function testEmptyHTML(text: string) {
    return client.indices.analyze({
        tokenizer: "keyword",
        char_filter: ["html_strip"],
        filter: ["trim"],
        text: text
    }).then((r) => r.tokens?.every((t: { token: string | any[]; }) => t.token.length === 0))
}

export async function indexJurisprudenciaDocumentFromURL(url: string): Promise<PartialJurisprudenciaDocument | undefined> {
    let obj = await createJurisprudenciaDocumentFromURL(url);
    if (!obj?.UUID) return;
    if (obj) {
        const r = await client.index({
            index: JurisprudenciaVersion,
            id: obj.UUID,
            body: obj
        });
        if (r.result === "created") {
            return obj;
        }
    }
}

export async function updateJurisprudenciaDocumentFromURL(id: string, url: string): Promise<PartialJurisprudenciaDocument | undefined> {
    let newObject = await createJurisprudenciaDocumentFromURL(url);
    if (!newObject) return;
    let currentObject = (await client.get<JurisprudenciaDocument>({ index: JurisprudenciaVersion, id: id, _source: true }))._source!;
    let updateObject: PartialJurisprudenciaDocument = {};
    const needsUpdate = newObject.HASH?.Original !== currentObject.HASH?.Original ||
        newObject.HASH?.Processo !== currentObject.HASH?.Processo ||
        newObject.HASH?.Data !== currentObject.HASH?.Data ||
        newObject.HASH?.["Meio Processual"] !== currentObject.HASH?.["Meio Processual"] ||
        newObject.HASH?.Texto !== currentObject.HASH?.Texto ||
        newObject.HASH?.Sumário !== currentObject.HASH?.Sumário ||
        newObject.UUID !== currentObject.UUID;

    if (!needsUpdate) { return; }
    // Concat only new values to CONTENT without duplicates
    let CONTENT = newObject.CONTENT?.filter(o => !currentObject.CONTENT?.includes(o)) || [];
    updateObject.CONTENT = currentObject.CONTENT?.concat(CONTENT);

    const conflictsObj: Partial<Record<JurisprudenciaDocumentDateKey | JurisprudenciaDocumentExactKey, { Current: string, New: string }>> = {}

    for (let key of JurisprudenciaDocumentKeys) {
        if (isJurisprudenciaDocumentContentKey(key)) continue;
        if (isJurisprudenciaDocumentDateKey(key) && newObject[key] && newObject[key] !== currentObject[key]) {
            if (!currentObject[key]) {
                updateObject[key] = newObject[key];
            }
            else {
                updateObject[key] = currentObject[key];
                conflictsObj[key] = { Current: currentObject[key] || "", New: newObject[key] || "" };
            }
        }
        if (isJurisprudenciaDocumentExactKey(key) && newObject[key] && newObject[key] !== currentObject[key]) {
            if (!currentObject[key] || key === "UUID") {
                updateObject[key] = newObject[key];
            }
            else {
                updateObject[key] = currentObject[key];
                conflictsObj[key] = { Current: currentObject[key] || "", New: newObject[key] || "" };
            }
        }
        if (isJurisprudenciaDocumentGenericKey(key)) {
            updateObject[key] = { ...(currentObject[key] || { Index: [], Show: [] }), Original: newObject[key]?.Original || [] };
        }
        if (isJurisprudenciaDocumentHashKey(key)) continue;
        if (isJurisprudenciaDocumentObjectKey(key)) {
            updateObject[key] = newObject[key];
        }
        if (isJurisprudenciaDocumentTextKey(key)) {
            updateObject[key] = newObject[key];
        };
        if (isJurisprudenciaDocumentStateKey(key)) continue;
    }

    updateObject["HASH"] = calculateHASH({
        Original: updateObject.Original,
        "Número de Processo": updateObject["Número de Processo"],
        Data: updateObject.Data,
        "Meio Processual": updateObject["Meio Processual"],
        Sumário: updateObject.Sumário,
        Texto: updateObject.Texto,
        STATE: updateObject.STATE
    });

    updateObject["STATE"] = currentObject.STATE;

    await conflicts(id, conflictsObj)

    const r = await client.update({
        index: JurisprudenciaVersion,
        id: id,
        body: {
            doc: updateObject
        }
    });

    if (r.result === "updated") {
        return updateObject;
    }
}