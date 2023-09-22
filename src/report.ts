import { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { client } from "./client";

export type Report = {
    target: string,
    dateStart: Date,
    created: number,
    updated: number,
    deleted: number, // On full update might be nice to check if all dgsi we have are still on dgsi
    dateEnd: Date,
    logs: string[]
}

export const ReportProps: Record<keyof Report, MappingProperty> = {
    target: {type: "keyword"},
    dateStart: {type: "date"},
    dateEnd: {type: "date"},
    created: {type: "float"},
    updated: {type: "float"},
    deleted: {type: "float"},
    logs: {type: "text"}
}

const ReportVersion = "jurisprudencia-indexer-report.0.0"

export async function report(report: Report){
    if(!(await client.indices.exists({index: ReportVersion}).catch(e => false))){
        await client.indices.create({
            index: ReportVersion,
            mappings: {properties: ReportProps},
            settings: {
                number_of_replicas: 0,
                number_of_shards: 1
            }
        })
    }
    await client.index<Report>({
        index: ReportVersion,
        document: report
    })
}

