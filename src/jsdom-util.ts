import {JSDOM} from "jsdom"

export async function JSDOMfromURL(url: string, retries: number=10){
    let start = Date.now();
    let lastSleep = 0;
    while( retries > 0 ){
        try{
            return await JSDOM.fromURL(url)
        }
        catch(e){
            console.error(`Failed to fetch ${url}, retrying...`);
            await new Promise(r => setTimeout(r, lastSleep*1000));
            lastSleep *= 2;
            retries--;
        }
    }
    throw new Error(`Failed to fetch ${url}`);
}