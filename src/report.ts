import { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { client } from "./client";
import { JurisprudenciaDocumentDateKey, JurisprudenciaDocumentExactKey } from "@stjiris/jurisprudencia-document";

export type Report = {
    target: string,
    dateStart: Date,
    created: number,
    updated: number,
    deleted: number, // On full update might be nice to check if all dgsi we have are still on dgsi
    skiped: number,
    dateEnd: Date,
    soft: boolean
}

export const ReportProps: Record<keyof Report, MappingProperty> = {
    target: {type: "keyword"},
    dateStart: {type: "date"},
    dateEnd: {type: "date"},
    created: {type: "float"},
    updated: {type: "float"},
    deleted: {type: "float"},
    skiped: {type: "float"},
    soft: {type: "boolean"}
}

const ReportVersion = "jurisprudencia-indexer-report.2.0"

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
    console.log(report);
}

export type ConflictsType = Partial<Record<JurisprudenciaDocumentExactKey|JurisprudenciaDocumentDateKey, Record<"Current"|"New", string>>>

export const ConflictsProps: Record<JurisprudenciaDocumentExactKey|JurisprudenciaDocumentDateKey, MappingProperty> = {
    "Número de Processo": {
        properties: {
            "Current": {type: "keyword"},
            "New": {type: "keyword"}
        }
    },
    Data: {
        properties: {
            "Current": {type: "keyword"},
            "New": {type: "keyword"}
        }
    },
    ECLI: {
        properties: {
            "Current": {type: "keyword"},
            "New": {type: "keyword"}
        }
    },
    Fonte: {
        properties: {
            "Current": {type: "keyword"},
            "New": {type: "keyword"}
        }
    },
    Tipo: {
        properties: {
            "Current": {type: "keyword"},
            "New": {type: "keyword"}
        }
    },
    URL: {
        properties: {
            "Current": {type: "keyword"},
            "New": {type: "keyword"}
        }
    },
    UUID: {
        properties: {
            "Current": {type: "keyword"},
            "New": {type: "keyword"}
        }
    }
}
    
const ConflictsVersion = "jurisprudencia-indexer-conflicts.2.0"

export async function conflicts(id: string, conflicts: any){
    if( Object.keys(conflicts).length === 0 ) return;
    if(!(await client.indices.exists({index: ConflictsVersion}).catch(e => false))){
        await client.indices.create({
            index: ConflictsVersion,
            mappings: {properties: ConflictsProps},
            settings: {
                number_of_replicas: 0,
                number_of_shards: 1
            }
        })
    }
    await client.index<ConflictsType>({
        index: ConflictsVersion,
        id,
        document: conflicts
    })
}
