import { FilesystemUpdate, SupportedUpdateSources, writeFilesystemUpdate } from "@stjiris/filesystem-lib";
import { JSDOM } from "jsdom";
import { report, Report } from "./report/report.js";
import { JurisprudenciaVersion } from "@stjiris/jurisprudencia-document";

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