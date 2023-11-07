import { JSDOMfromURL } from "./jsdom-util";

export const DGSI_MAIN_PAGE = "http://www.dgsi.pt/jstj.nsf?OpenDatabase"
export const DGSI_LINK_PATT = /http:\/\/www\.dgsi\.pt\/jstj\.nsf\/([^/]+)\/([^/]+)\?OpenDocument/;

export async function* allLinks(){
    let visited: Record<string, true> = {}
    let currurl: string | undefined = DGSI_MAIN_PAGE;
    while( currurl !== undefined ){
        let page = await JSDOMfromURL(currurl);
        let anchorList = Array.from(page.window.document.querySelectorAll("a"))
        let next = anchorList.find( l => l.textContent === "Seguinte" )?.href
        let courtList = anchorList.map(a => a.href).filter(u => u.match(DGSI_LINK_PATT))
        for( let decision of courtList ){
            if( decision in visited ) continue;
            yield decision;
            visited[decision] = true;
        }
        if( next == currurl ){
            break;
        }
        currurl = next
    }
}