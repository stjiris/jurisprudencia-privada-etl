import { calculateUUID, HASHField, JurisprudenciaDocument, JurisprudenciaDocumentDateKey, JurisprudenciaDocumentGenericKey, JurisprudenciaDocumentKey, JurisprudenciaDocumentKeys, JurisprudenciaVersion, PartialJurisprudenciaDocument, isJurisprudenciaDocumentContentKey, isJurisprudenciaDocumentDateKey, isJurisprudenciaDocumentExactKey, isJurisprudenciaDocumentGenericKey, isJurisprudenciaDocumentHashKey, isJurisprudenciaDocumentObjectKey, isJurisprudenciaDocumentStateKey, isJurisprudenciaDocumentTextKey, JurisprudenciaDocumentProperties, JurisprudenciaDocumentExactKey, calculateHASH } from "@stjiris/jurisprudencia-document";
import { JSDOM } from "jsdom";
import { authPromise, client, info } from "./client";
import { createHash } from "crypto";
import { IndexResponse, UpdateResponse, WriteResponseBase } from "@elastic/elasticsearch/lib/api/types";
import { conflicts } from "./report";
import { getNext } from "./dgsi-links";
import path from "path";

export async function jurisprudenciaOriginalFromURL(url: string) {
    if (!url.endsWith(".doc") && !url.endsWith(".docx")) return null;

    const cookie = await authPromise.then(options => options.headers.Cookie);
    const fileFetch = await fetch(url, {
        headers: {
            cookie
        },
    });
    const fd = new FormData();
    fd.append("file", await fileFetch.blob(), "file." + url.split(".").pop());
    let html = await fetch("https://iris.sysresearch.org/anonimizador/html", {
        method: "POST",
        body: fd,
    }).then(r => r.text());

    let decisaoTextoIntegral = new JSDOM(html);
    const fileUrl = new URL(url);
    let reqInfo = info.getFileByServerRelativeUrl(fileUrl.pathname).getInfo();
    let proc = decodeURI(fileUrl.pathname);
    let data = await getNext(reqInfo.url);
    return {
        "Decisão Texto Integral": decisaoTextoIntegral.window.document.body,
        "Metadata": new JSDOM(JSON.stringify(data)).window.document.body,
        "Processo": new JSDOM(proc).window.document.body,
    };
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
    let table: any = await jurisprudenciaOriginalFromURL(url);
    if (!table) return;

    let Original: JurisprudenciaDocument["Original"] = {};
    let CONTENT: JurisprudenciaDocument["CONTENT"] = [];
    let Tipo: JurisprudenciaDocument["Tipo"] = "Acordão";
    let numProc: JurisprudenciaDocument["Número de Processo"] = table.Processo?.textContent?.trim();
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
        "Fonte": "STJ (Sharepoint)",
        "URL": url,
        "Jurisprudência": { Index: ["Simples"], Original: ["Simples"], Show: ["Simples"] },
        "STATE": "privado",
    }
    addGenericField(obj, "Relator Nome Profissional", table, "Relator");
    addGenericField(obj, "Relator Nome Completo", table, "Relator");
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
        console.log(obj);
        return client.index({
            index: JurisprudenciaVersion,
            body: obj
        })
    }
}
