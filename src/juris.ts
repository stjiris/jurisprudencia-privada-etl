import { Client, estypes } from "@elastic/elasticsearch";
import { JurisprudenciaVersion, PartialJurisprudenciaDocument } from "@stjiris/jurisprudencia-document";

export const client = new Client({ node: process.env.ES_URL || "http://localhost:9200", auth: { username: process.env.ES_USER || "", password: process.env.ES_PASS || "" } });

export async function updateJurisDocument(jurisprudencia_document: PartialJurisprudenciaDocument): Promise<estypes.IndexResponse | undefined> {
    if (!jurisprudencia_document.UUID)
        return;
    return client.index({
        index: JurisprudenciaVersion,
        id: jurisprudencia_document.UUID,
        body: jurisprudencia_document
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
