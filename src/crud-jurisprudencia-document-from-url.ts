import { HASHField, JurisprudenciaDocument, JurisprudenciaDocumentGenericKeys, JurisprudenciaDocumentKey, JurisprudenciaVersion, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";
import {JSDOM} from "jsdom";
import { client } from "./client";
import { createHash } from "crypto";
import { DescritorOficial } from "./descritor-oficial";

export async function jurisprudenciaOriginalFromURL(url: string){
    if( url.match(/http:\/\/www\.dgsi\.pt\/([^/]+)\.nsf\/([^/]+)\/([^/]*)\?OpenDocument/) ){
        let page = await JSDOM.fromURL(url);
        let tables = Array.from(page.window.document.querySelectorAll("table")).filter( o => !o.parentElement?.closest("table") );
        return tables.flatMap( table => Array.from(table.querySelectorAll("tr")).filter( row => row.closest("table") == table ) )
            .filter( tr => tr.cells.length > 1 )
            .reduce((acc, tr) => {
                    let key = tr.cells[0].textContent?.replace(":","").trim()
                    let value = tr.cells[1];
                    if( key && key.length > 0 ){
                        acc[key] = value;
                    }
                    return acc;
            }, {} as Record<string, HTMLTableCellElement | undefined>);
    }

    return null;
}

function addGenericField(obj: PartialJurisprudenciaDocument, key: JurisprudenciaDocumentGenericKeys, table: Record<string, HTMLTableCellElement | undefined>, tableKey: string){
    let val = table[tableKey]?.textContent?.trim().split("\n");
    if( val ){
        obj[key] = {
            Index: val,
            Original: val,
            Show: val
        }
    }
}



function addDescritores(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>){
    if( table.Descritores ){
        // TODO: handle , and ; in descritores (e.g. "Ação Civil; Ação Civil e Administrativa") however dont split some cases (e.g. "Art 321º, do código civil")
        let desc = table.Descritores.textContent?.trim().split(/\n|;/).map( desc => desc.trim().replace(/\.$/g,'').replace(/^(:|-|,|"|“|”|«|»|‘|’)/,'').trim() ).filter( desc => desc.length > 0 ).map(desc => DescritorOficial[desc])
        if(desc && desc.length > 0 ){
            obj.Descritores = {
                Index: desc,
                Original: desc,
                Show: desc
            }
        }
    }
}

function addMeioProcessual(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>){
    if( table["Meio Processual"] ){
        let meios = table["Meio Processual"].textContent?.trim().split(/(\/|-|\n)/).map(meio => meio.trim().replace(/\.$/,''));
        if( meios && meios.length > 0){
            obj["Meio Processual"] = {
                Index: meios,
                Original: meios,
                Show: meios
            }
        }
    }
}

function addVotacao(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>){
    if( table.Votação ){
        let text = table.Votação.textContent?.trim();
        if(text){
            if( text.match(/^-+$/) ) return;
            if( text.match(/unanimidade/i) ){
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

function addSeccaoAndArea(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>){
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

    if( SECÇÃO_TABLE_KEY in table ){
        let sec = table[SECÇÃO_TABLE_KEY]?.textContent?.trim();
        if( sec?.match(/Cons?tencioso/) ){
            obj.Secção = obj.Área = {
                Index: ["Contencioso"],
                Original: ["Contencioso"],
                Show: ["Contencioso"]
            }
        }
        else if(sec?.match(/se/i) ){
            let num = sec.match(/^(1|2|3|4|5|6|7)/);
            if( num ){
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
    else if("Nº do Documento" in table){
        let num = table["Nº do Documento"]?.textContent?.trim().match(/(SJ)?\d+(1|2|3|4|5|6|7)$/);
        if( num ){
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

function testEmptyHTML(text: string){
    return client.indices.analyze({
        tokenizer: "keyword",
        char_filter: ["html_strip"],
        filter: ["trim"],
        text: text
    }).then(r => r.tokens?.every(t => t.token.length === 0))
}

function stripHTMLAttributes(text: string){
    let regex = /<(?<closing>\/?)(?<tag>\w+)(?<attrs>[^>]*)>/g;
    var comments = /<!--[\s\S]*?-->/gi;
    return text.replace(comments, '').replace(regex, "<$1$2>");
}

async function addSumarioAndTexto(obj: PartialJurisprudenciaDocument, table: Record<string, HTMLTableCellElement | undefined>){
    let sum = table.Sumário?.innerHTML || "";
    let tex = table["Decisão Texto Integral"]?.innerHTML || "";
    let [emptySum, emptyTex] = await Promise.all([testEmptyHTML(sum), testEmptyHTML(tex)]);
    if( !emptySum ){
        obj.Sumário = stripHTMLAttributes(sum);
    }
    if( !emptyTex ){
        obj.Texto = stripHTMLAttributes(tex);
    }
}

function calculateUUID(obj: PartialJurisprudenciaDocument | HASHField, keys: (JurisprudenciaDocumentKey | keyof HASHField)[]=[]){
    let str = JSON.stringify(obj, keys);
    let hash = createHash("sha1");
    hash.write(str);
    return hash.digest().toString("base64url");
}

export async function createJurisprudenciaDocumentFromURL(url: string){
    let table = await jurisprudenciaOriginalFromURL(url);
    if( !table ) return;
    
    let Original: JurisprudenciaDocument["Original"] = {};
    let CONTENT: JurisprudenciaDocument["CONTENT"] = [];
    let Data: JurisprudenciaDocument["Data"] = "01/01/1900";
    let Tipo: JurisprudenciaDocument["Tipo"] = "Acordão";
    let numProc: JurisprudenciaDocument["Número de Processo"] = table.Processo?.textContent?.trim().replace(/\s-\s.*$/, "").replace(/ver\s.*/, "");


    for( let key in table ){
        let text = table[key]?.textContent?.trim();
        if( !text ) continue;
        if( key.startsWith("Data") ){
            // Handle MM/DD/YYYY format to DD/MM/YYYY
            text = text.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$2/$1/$3");
            Original[key] = text;
            let otherTipo = key.match(/Data d. (.*)/);
            if( otherTipo && Tipo === "Acordão" ){
                Tipo = otherTipo[1].trim()
                Data = text;
            }
        }
        else{
            Original[key] = table[key]!.innerHTML;
        }
        CONTENT.push(text)
    }

    let obj: PartialJurisprudenciaDocument = {
        "Original": Original,
        "CONTENT": CONTENT,
        "Data": Data,
        "Número de Processo": numProc,
        "Fonte": "STJ (DGSI)",
        "URL": url,
        "Jurisprudência": {Index: ["Simples"], Original: ["Simples"], Show: ["Simples"]}
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

    addSumarioAndTexto(obj, table)

    obj["HASH"] = {
        Original: calculateUUID(obj, ["Original"]),
        Processo: calculateUUID(obj, ["Número de Processo"]),
        Sumário: calculateUUID(obj, ["Sumário"]),
        Texto: calculateUUID(obj, ["Texto"]),
    }

    obj["UUID"] = calculateUUID(obj["HASH"], ["Sumário", "Texto", "Processo"])

    await client.index<PartialJurisprudenciaDocument>({
        index: JurisprudenciaVersion,
        document: obj
    })
}

export async function updateJurisprudenciaDocumentFromURL(id: string, url: string){
    
}