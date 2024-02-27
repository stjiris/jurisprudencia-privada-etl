import { Client } from "@elastic/elasticsearch";
import { $REST } from "gd-sprest";
import { getAuth } from "node-sp-auth";

export const client = new Client({ node: process.env.ES_URL || "http://localhost:9200", auth: { username: process.env.ES_USER || "", password: process.env.ES_PASS || "" } });

if (!process.env.SHAREPOINT_USER || !process.env.SHAREPOINT_PASS) {
    process.stdout.write(`Use SHAREPOINT_USER and SHAREPOINT_PASS environment variables to setup the sharepoint client\n`)
    process.exit(1);
}

export const url = process.env.SHAREPOINT_URL!;
if (!url) {
    process.stdout.write(`Use SHAREPOINT_URL environment variable to setup the sharepoint client\n`)
    process.exit(1);
}

export const authPromise = getAuth(url, {
    username: process.env.SHAREPOINT_USER,
    password: process.env.SHAREPOINT_PASS,
    online: true,
})

export const info = $REST.Web(url);