import { JurisprudenciaVersion } from "@stjiris/jurisprudencia-document";
import { FilesystemDocument } from "./filesystem";
import { Client } from "@elastic/elasticsearch";

// todo test
export const client = new Client({ node: process.env.ES_URL || "http://localhost:9200", auth: { username: process.env.ES_USER || "", password: process.env.ES_PASS || "" } });
export async function indexJurisDocument(filesystem_document: FilesystemDocument): Promise<void> {
    const response = await client.index({ index: JurisprudenciaVersion, body: filesystem_document.jurisprudencia_document });
    if (response) {
        console.log(response);
    }
}