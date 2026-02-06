import { ContentType, Date_Area_Section, DescritorOficial, extractContent, FilesystemUpdate, Retrievable_Metadata, Sharepoint_Metadata, SupportedUpdateSources, writeFilesystemUpdate } from "@stjiris/filesystem-lib";
import { JSDOM } from "jsdom";
import { report, Report } from "./report/report.js";
import { calculateHASH, calculateUUID, JurisprudenciaDocument, JurisprudenciaVersion, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";

export async function JSDOMfromURL(url: string, retries: number = 10) {
    let start = Date.now();
    let lastSleep = 0;
    while (retries > 0) {
        try {
            return await JSDOM.fromURL(url)
        }
        catch (e) {
            console.error(`Failed to fetch ${url}, retrying...`);
            await new Promise(r => setTimeout(r, lastSleep * 1000));
            lastSleep *= 2;
            retries--;
        }
    }
    throw new Error(`Failed to fetch ${url}`);
}

export async function terminateUpdate(update: FilesystemUpdate, message: string, source: SupportedUpdateSources): Promise<void> {
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
        writeFilesystemUpdate(update, source);
        console.log(info);
        report(info)
    } catch (e) {
        console.error(e);
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
    if (retrievable_Metadata.process_mean.includes("Sumário")) {
        obj.Sumário = content.map(line => `<p><font>${line}</font><br>`).join('');
        obj.Texto = "";
    } else {
        obj.Sumário = "";
        obj.Texto = content.map(line => `<p><font>${line}</font><br>`).join('');
    }
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
        obj["Meio Processual"] = { Index: retrievable_Metadata.process_mean, Original: retrievable_Metadata.process_mean, Show: retrievable_Metadata.process_mean };
    }
    if (retrievable_Metadata.decision && retrievable_Metadata.decision.length > 0) {
        obj["Decisão"] = { Index: [retrievable_Metadata.decision], Original: [retrievable_Metadata.decision], Show: [retrievable_Metadata.decision] };
    }

    obj["HASH"] = calculateHASH({
        ...obj,
        Original: obj.Original,
        "Número de Processo": obj["Número de Processo"],
        Data: obj.Data,
        "Meio Processual": obj["Meio Processual"],
        "Texto": obj.Texto,
        "Texto Não Anonimizado": obj.Texto,
        "Sumário": obj.Sumário,
        "Sumário Não Anonimizado": obj.Sumário,
    })

    obj["UUID"] = calculateUUID(obj["HASH"]);
    return obj;
}