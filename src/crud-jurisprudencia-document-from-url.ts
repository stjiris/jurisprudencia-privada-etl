import { calculateUUID, HASHField, JurisprudenciaDocument, JurisprudenciaDocumentDateKey, JurisprudenciaDocumentGenericKey, JurisprudenciaDocumentKey, JurisprudenciaDocumentKeys, JurisprudenciaVersion, PartialJurisprudenciaDocument, isJurisprudenciaDocumentContentKey, isJurisprudenciaDocumentDateKey, isJurisprudenciaDocumentExactKey, isJurisprudenciaDocumentGenericKey, isJurisprudenciaDocumentHashKey, isJurisprudenciaDocumentObjectKey, isJurisprudenciaDocumentStateKey, isJurisprudenciaDocumentTextKey, JurisprudenciaDocumentProperties, JurisprudenciaDocumentExactKey, calculateHASH } from "@stjiris/jurisprudencia-document";
import { JSDOM } from "jsdom";
import { client } from "./client";
import { createHash } from "crypto";
import { DescritorOficial } from "./descritor-oficial";
import { IndexResponse, UpdateResponse, WriteResponseBase } from "@elastic/elasticsearch/lib/api/types";
import { conflicts } from "./report";
import { JSDOMfromURL } from "./jsdom-util";
import { DGSI_LINK_PATT } from "./dgsi-links";

export async function jurisprudenciaOriginalFromURL(url: string) {
    if (url.match(DGSI_LINK_PATT)) {
        let page = await JSDOMfromURL(url);
        let tables = Array.from(page.window.document.querySelectorAll("table")).filter(o => !o.parentElement?.closest("table"));
        return tables.flatMap(table => Array.from(table.querySelectorAll("tr")).filter(row => row.closest("table") == table))
            .filter(tr => tr.cells.length > 1)
            .reduce((acc, tr) => {
                let key = tr.cells[0].textContent?.replace(":", "").trim()
                let value = tr.cells[1];
                if (key && key.length > 0) {
                    acc[key] = value;
                }
                return acc;
            }, {} as Record<string, HTMLTableCellElement | undefined>);
    }

    return null;
}

function addGenericField(obj: PartialJurisprudenciaDocument, key: JurisprudenciaDocumentGenericKey, table: Record<string, HTMLTableCellElement | undefined>, tableKey: string) {
    let val = table[tableKey]?.textContent?.trim().split("\n");
    if (val) {
        obj[key] = {
            Index: val,
            Original: val,
            Show: val,
        }
    }
}



function addDescritores(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>) {
    if (table.Descritores) {
        // TODO: handle , and ; in descritores (e.g. "Ação Civil; Ação Civil e Administrativa") however dont split some cases (e.g. "Art 321º, do código civil")
        let desc = table.Descritores.textContent?.trim().split(/\n|;/).map(desc => desc.trim().replace(/\.$/g, '').replace(/^(:|-|,|"|“|”|«|»|‘|’)/, '').trim()).filter(desc => desc.length > 0)
        if (desc && desc.length > 0) {
            obj.Descritores = {
                Index: desc.map(desc => DescritorOficial[desc]),
                Original: desc,
                Show: desc.map(desc => DescritorOficial[desc])
            }
        }
    }
}

function addMeioProcessual(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>) {
    if (table["Meio Processual"]) {
        let meios = table["Meio Processual"].textContent?.trim().split(/(\/|-|\n)/).map(meio => meio.trim().replace(/\.$/, ''));
        if (meios && meios.length > 0) {
            obj["Meio Processual"] = {
                Index: meios,
                Original: meios,
                Show: meios
            }
        }
    }
}

function addVotacao(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>) {
    if (table.Votação) {
        let text = table.Votação.textContent?.trim();
        if (text) {
            if (text.match(/^-+$/)) return;
            if (text.match(/unanimidade/i)) {
                obj["Votação"] = {
                    Index: ["Unanimidade"],
                    Original: ["Unanimidade"],
                    Show: ["Unanimidade"]
                }
            }
            else {
                obj["Votação"] = {
                    Index: [text],
                    Original: [text],
                    Show: [text]
                }
            }
        }
    }
}

function addSeccaoAndArea(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>) {
    const SECÇÃO_TABLE_KEY = "Nº Convencional";
    const Secções = {
        SECÇÃO_1: "1.ª Secção (Cível)",
        SECÇÃO_2: "2.ª Secção (Cível)",
        SECÇÃO_3: "3.ª Secção (Criminal)",
        SECÇÃO_4: "4.ª Secção (Social)",
        SECÇÃO_5: "5.ª Secção (Criminal)",
        SECÇÃO_6: "6.ª Secção (Cível)",
        SECÇÃO_7: "7.ª Secção (Cível)"
    };
    const Áreas = {
        SECÇÃO_1: "Área Cível",
        SECÇÃO_2: "Área Cível",
        SECÇÃO_3: "Área Criminal",
        SECÇÃO_4: "Área Social",
        SECÇÃO_5: "Área Criminal",
        SECÇÃO_6: "Área Cível",
        SECÇÃO_7: "Área Cível"
    }

    if (SECÇÃO_TABLE_KEY in table) {
        let sec = table[SECÇÃO_TABLE_KEY]?.textContent?.trim();
        if (sec?.match(/Cons?tencioso/)) {
            obj.Secção = obj.Área = {
                Index: ["Contencioso"],
                Original: ["Contencioso"],
                Show: ["Contencioso"]
            }
        }
        else if (sec?.match(/se/i)) {
            let num = sec.match(/^(1|2|3|4|5|6|7)/);
            if (num) {
                let key = `SECÇÃO_${num[0]}` as keyof typeof Secções;
                obj.Secção = {
                    Index: [Secções[key]],
                    Original: [Secções[key]],
                    Show: [Secções[key]]
                }
                obj.Área = {
                    Index: [Áreas[key]],
                    Original: [Áreas[key]],
                    Show: [Áreas[key]]
                }
            }
        }
    }
    else if ("Nº do Documento" in table) {
        let num = table["Nº do Documento"]?.textContent?.trim().match(/(SJ)?\d+(1|2|3|4|5|6|7)$/);
        if (num) {
            let key = `SECÇÃO_${num[0]}` as keyof typeof Secções;
            obj.Secção = {
                Index: [Secções[key]],
                Original: [Secções[key]],
                Show: [Secções[key]]
            }
            obj.Área = {
                Index: [Áreas[key]],
                Original: [Áreas[key]],
                Show: [Áreas[key]]
            }
        }
    }
}

function testEmptyHTML(text: string) {
    return client.indices.analyze({
        tokenizer: "keyword",
        char_filter: ["html_strip"],
        filter: ["trim"],
        text: text
    }).then(r => r.tokens?.every(t => t.token.length === 0))
}

function stripHTMLAttributes(text: string) {
    let regex = /<(?<closing>\/?)(?<tag>\w+)(?<attrs>[^>]*)>/g;
    var comments = /<!--[\s\S]*?-->/gi;
    return text.replace(comments, '').replace(regex, "<$1$2>");
}

async function addSumarioAndTexto(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>) {
    let sum = table.Sumário?.innerHTML || "";
    let tex = table["Decisão Texto Integral"]?.innerHTML || "";
    let [emptySum, emptyTex] = await Promise.all([testEmptyHTML(sum), testEmptyHTML(tex)]);
    if (!emptySum) {
        obj.Sumário = stripHTMLAttributes(sum);
    }
    if (!emptyTex) {
        obj.Texto = stripHTMLAttributes(tex);
    }
}

export async function createJurisprudenciaDocumentFromURL(url: string) {
    let table = await jurisprudenciaOriginalFromURL(url);
    if (!table) return;

    let Original: JurisprudenciaDocument["Original"] = {};
    let CONTENT: JurisprudenciaDocument["CONTENT"] = [];
    let Tipo: JurisprudenciaDocument["Tipo"] = "Acordão";
    let numProc: JurisprudenciaDocument["Número de Processo"] = table.Processo?.textContent?.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, "");
    let DataAcordao: JurisprudenciaDocument["Data"] | null = null;
    let DataToUse: JurisprudenciaDocument["Data"] | null = null;
    /*
    Tipo logic from https://github.com/stjiris/version-converter/blob/3a749c94c639081a797b83aa33a520e45e8e909e/src/converters/11withTipo.ts#L56-L59
    def decSuma = ctx['_source']['Original'].containsKey("Data da Decisão Sumária") || ctx['_source']['Original'].containsKey("Data de decisão sumária");
    def decSing = ctx['_source']['Original'].containsKey("Data da Decisão Singular");
    def reclama = ctx['_source']['Original'].containsKey("Data da Reclamação");
    ctx['_source']['Tipo'] = decSuma ? "Decisão Sumária" : decSing ? "Decisão Singular" : reclama ? "Reclamação" : "Acórdão";
    */
    for (let key in table) {
        let text = table[key]?.textContent?.trim();
        if (!text) continue;
        if (key.startsWith("Data")) {
            // Handle MM/DD/YYYY format to DD/MM/YYYY
            text = text.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$2/$1/$3");
            Original[key] = text;
            let decSuma = key.match(/Data da Decisão Sumária/) || key.match(/Data de decisão sumária/);
            let decSing = key.match(/Data da Decisão Singular/);
            let reclama = key.match(/Data da Reclamação/);
            let otherTipo = decSuma || decSing || reclama;
            if (otherTipo && Tipo === "Acordão") {
                Tipo = decSuma ? "Decisão Sumária" : decSing ? "Decisão Singular" : reclama ? "Reclamação" : "Acórdão";
                DataToUse = text;
            }
            if (!otherTipo) {
                DataAcordao = text;
            }
        }
        else {
            Original[key] = table[key]!.innerHTML;
        }
        CONTENT.push(text)
    }
    let Data: JurisprudenciaDocument["Data"] = DataToUse || DataAcordao || "01/01/1900";

    let obj: PartialJurisprudenciaDocument = {
        "Original": Original,
        "CONTENT": CONTENT,
        "Data": Data,
        "Número de Processo": numProc,
        "Fonte": "STJ (DGSI)",
        "URL": url,
        "Jurisprudência": { Index: ["Simples"], Original: ["Simples"], Show: ["Simples"] },
        "STATE": "público",
    }
    addGenericField(obj, "Relator Nome Profissional", table, "Relator");
    addGenericField(obj, "Relator Nome Completo", table, "Relator");
    addDescritores(obj, table)
    addMeioProcessual(obj, table)
    addVotacao(obj, table)
    addSeccaoAndArea(obj, table)
    addGenericField(obj, "Decisão", table, "Decisão");
    addGenericField(obj, "Tribunal de Recurso", table, "Tribunal Recurso")
    addGenericField(obj, "Tribunal de Recurso - Processo", table, "Processo no Tribunal Recurso")
    addGenericField(obj, "Área Temática", table, "Área Temática")
    addGenericField(obj, "Jurisprudência Estrangeira", table, "Jurisprudência Estrangeira")
    addGenericField(obj, "Jurisprudência Internacional", table, "Jurisprudência Internacional")
    addGenericField(obj, "Jurisprudência Nacional", table, "Jurisprudência Nacional")
    addGenericField(obj, "Doutrina", table, "Doutrina")
    addGenericField(obj, "Legislação Comunitária", table, "Legislação Comunitária")
    addGenericField(obj, "Legislação Estrangeira", table, "Legislação Estrangeira")
    addGenericField(obj, "Legislação Nacional", table, "Legislação Nacional")
    addGenericField(obj, "Referências Internacionais", table, "Referências Internacionais")
    addGenericField(obj, "Referência de publicação", table, "Referência de publicação")
    addGenericField(obj, "Indicações Eventuais", table, "Indicações Eventuais")

    await addSumarioAndTexto(obj, table)

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

export async function indexJurisprudenciaDocumentFromURL(url: string): Promise<IndexResponse | undefined> {
    let obj = await createJurisprudenciaDocumentFromURL(url);
    if (obj) {
        return client.index({
            index: JurisprudenciaVersion,
            body: obj
        })
    }
}

export async function updateJurisprudenciaDocumentFromURL(id: string, url: string): Promise<UpdateResponse | undefined> {
    let newObject = await createJurisprudenciaDocumentFromURL(url);
    if (!newObject) return;
    let currentObject = (await client.get<JurisprudenciaDocument>({ index: JurisprudenciaVersion, id: id, _source: true }))._source!;
    let updateObject: PartialJurisprudenciaDocument = {};
    const needsUpdate = newObject.HASH?.Original !== currentObject.HASH?.Original ||
        newObject.HASH?.Processo !== currentObject.HASH?.Processo ||
        newObject.HASH?.Sumário !== currentObject.HASH?.Sumário ||
        newObject.HASH?.Texto !== currentObject.HASH?.Texto ||
        newObject.UUID !== currentObject.UUID;

    if (!needsUpdate) { return; }
    // Concat only new values to CONTENT without duplicates
    let CONTENT = newObject.CONTENT?.filter(o => !currentObject.CONTENT?.includes(o)) || [];
    updateObject.CONTENT = currentObject.CONTENT?.concat(CONTENT);

    const conflictsObj: Partial<Record<JurisprudenciaDocumentDateKey | JurisprudenciaDocumentExactKey, { Current: string, New: string }>> = {}

    for (let key of JurisprudenciaDocumentKeys) {
        if (isJurisprudenciaDocumentContentKey(key)) continue; // DONE ABOVE
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
        if (isJurisprudenciaDocumentHashKey(key)) continue; // DONE BELOW
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
        "Número de Processo": updateObject["Número de Processo"] || "",
        Sumário: updateObject.Sumário || "",
        Texto: updateObject.Texto || ""
    });

    updateObject["UUID"] = calculateUUID(updateObject["HASH"])
    updateObject["STATE"] = currentObject.STATE;

    await conflicts(id, conflictsObj)

    return await client.update({
        index: JurisprudenciaVersion,
        id: id,
        body: {
            doc: updateObject
        }
    })
}