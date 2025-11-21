import { JSDOM } from "jsdom";

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

export function envOrFail(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
}

export function envOrFailArray(name: string): string[] {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return JSON.parse(value)
}

export function envOrFailDict(name: string): Record<string, string> {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return JSON.parse(value)
}