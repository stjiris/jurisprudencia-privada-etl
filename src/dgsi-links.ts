import { Types } from "gd-sprest";
import { authPromise, info } from "./client";

export async function* allLinks() {
    let reqInfo = info.Lists().getByTitle("Shared Documents").Items().query!({
        Expand: ["File"],
    }).getInfo();

    let data = await getResultList(reqInfo);
    do {
        for (let r of data.d.results) {
            let fullUrl = new URL(reqInfo.url);
            if (r.FileSystemObjectType !== 0) {
                console.warn(`===== Skipping: ${r.__metadata.uri} because it is not a file (${r.FileSystemObjectType}) =====`);
                continue;
            };
            fullUrl.pathname = r.File.ServerRelativeUrl;
            fullUrl.search = "";
            fullUrl.hash = "";
            yield fullUrl.toString();
        }
        if (data.d.__next) {
            data = await getNext(data.d.__next);
        }
    } while (data.d.__next);
}

async function getResultList(req: Types.Base.IRequestInfo) {
    const options = await authPromise;
    return fetch(req.url, {
        headers: {
            cookie: options.headers.Cookie,
            accept: 'application/json;odata=verbose'
        }
    }).then(r => r.json())
}

export async function getNext(url: string) {
    const options = await authPromise;
    return fetch(url, {
        headers: {
            cookie: options.headers.Cookie,
            accept: 'application/json;odata=verbose'
        }
    }).then(r => {
        if (r.status !== 200) console.error(r);
        return r.json();
    }).catch();
}