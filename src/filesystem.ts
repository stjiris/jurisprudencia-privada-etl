import { Report } from "./report/report";
import fs from "fs";
import path from "path";
import XLSX from "xlsx";

export enum FileState { CREATED = "CREATED", UPDATED = "UPDATED", DELETED = "DELETED", UPDATED_METADATA = "UPDATED_METADATA" };
type Filesystem_Update_Paths = { previous_sharepoint_path?: string, sharepoint_path: string, previous_system_path?: string, system_path: string }
type Metadata = { process_number?: string, judge?: string, decision?: string, process_mean?: string, descriptors?: string[], section?: string; area?: string; date?: Date }

const ACORDAOS_PATH = "/Acordãos"
const COMPLETE_FILESYSTEM_PATH = `${ACORDAOS_PATH}/FileSystem`
const SHAREPOINT_COPY_PATH = `${ACORDAOS_PATH}/Sharepoint`
const LOGS_PATH = "/Updates"

const DETAILS_NAME = "Details"
const CONTENT_NAME = "Content"
const UPDATE_NAME = "Update"

export class FileSystemDocument {
    // properties from sharepoint
    sharepoint_id: string;
    sharepoint_path: string;
    creation_date: Date;
    last_update_date: Date;
    sharepoint_url: string;
    original_name: string;
    xor_hash: string;
    size: number;
    drive_name: string;
    drive_id: string;
    content?: Buffer;
    extension?: string;

    // other metadata
    filesystem_date: Date;
    file_paths: Filesystem_Update_Paths;

    state: FileState;

    metadata?: Metadata;

    constructor(
        sharepoint_id: string,
        sharepoint_path: string,
        creation_date: Date,
        last_update_date: Date,
        sharepoint_url: string,
        original_name: string,
        xor_hash: string,
        size: number,
        drive_name: string,
        drive_id: string,
        sharepoint_path_rel: string,
        filesystem_path: string,
    ) {
        // properties from sharepoint
        this.sharepoint_id = sharepoint_id;
        this.sharepoint_path = sharepoint_path;
        this.creation_date = new Date(creation_date);
        this.last_update_date = new Date(last_update_date);
        this.sharepoint_url = sharepoint_url;
        this.original_name = original_name;
        this.xor_hash = xor_hash;
        this.size = size;
        this.drive_name = drive_name;
        this.drive_id = drive_id;
        this.content = undefined;
        this.extension = undefined;

        this.file_paths = { sharepoint_path: sharepoint_path_rel, system_path: filesystem_path };
        this.filesystem_date = new Date();
        this.state = FileState.CREATED;
    }

    addMetadata(metadata_doc: FileSystemDocument | void): void {
        if (!metadata_doc || !metadata_doc.metadata)
            return;
        if (!this.metadata) {
            this.metadata = metadata_doc.metadata;
            return;
        }
        this.metadata.process_number = this.metadata.process_number ?? metadata_doc.metadata.process_number;
        this.metadata.area = this.metadata.area ?? metadata_doc.metadata.area;
        this.metadata.section = this.metadata.section ?? metadata_doc.metadata.section;
        this.metadata.decision = this.metadata.decision ?? metadata_doc.metadata.decision;
        this.metadata.descriptors = this.metadata.descriptors ?? metadata_doc.metadata.descriptors;
        this.metadata.judge = this.metadata.judge ?? metadata_doc.metadata.judge;
        this.metadata.process_mean = this.metadata.process_mean ?? metadata_doc.metadata.process_mean;
    }

    toJson(): string {
        const obj: any = {
            sharepoint_id: this.sharepoint_id,
            sharepoint_path: this.sharepoint_path,
            creation_date: this.creation_date,
            last_update_date: this.last_update_date,
            sharepoint_url: this.sharepoint_url,
            original_name: this.original_name,
            xor_hash: this.xor_hash,
            size: this.size,
            drive_name: this.drive_name,
            drive_id: this.drive_id,
            extension: this.extension,
            filesystem_date: this.filesystem_date.toISOString(),
            state: this.state,
            file_paths: this.file_paths,
            metadata: this.metadata
        };

        for (const k of Object.keys(obj)) {
            if (obj[k] === undefined) delete obj[k];
        }

        return JSON.stringify(obj, null, 2);
    }

    static fromJson(input: string): FileSystemDocument | void {
        let txt: string | null = null;
        try {
            txt = fs.readFileSync(input, "utf8");
        } catch {
            txt = null;
        }
        if (!txt)
            return
        const raw_json = JSON.parse(txt);
        const toDate = (v: any) => (v ? new Date(v) : new Date());

        const doc = new FileSystemDocument(raw_json.sharepoint_id ?? "",
            raw_json.sharepoint_path ?? "",
            toDate(raw_json.creation_date),
            toDate(raw_json.last_update_date),
            raw_json.sharepoint_url ?? "",
            raw_json.original_name ?? "",
            raw_json.xor_hash ?? "",
            Number(raw_json.size ?? 0),
            raw_json.drive_name ?? "",
            raw_json.drive_id ?? "",
            raw_json.file_paths?.sharepoint_path ?? "",
            raw_json.file_paths?.system_path ?? ""
        )

        doc.filesystem_date = toDate(raw_json.filesystem_date);
        doc.metadata = raw_json.metadata ?? {};

        return doc;

    }

}

// TODO
export function generateRelPath(sharepoint_path: string, drive_id: string, drive_name: string): string {
    if (!sharepoint_path)
        return `/${drive_name}`;

    const marker = `/drives/${drive_id}`;
    const start = sharepoint_path.indexOf(marker);

    let rest = start >= 0 ? sharepoint_path.slice(start + marker.length) : sharepoint_path;

    rest = rest.replace(/^\/drive\/root:|^\/root:|^:/, "");

    if (!rest.startsWith("/"))
        rest = "/" + rest;

    return `/${drive_name}${rest}`;
}


export class FileSystemUpdate {
    constructor(
        public target_drive?: string,
        public date_start: Date = new Date(),
        public date_end?: Date,
        public created_num: number = 0,
        public created: Set<Filesystem_Update_Paths> = new Set(),
        public deleted_num: number = 0,
        public deleted: Set<Filesystem_Update_Paths> = new Set(),
        public updated_num: number = 0,
        public updated: Set<Filesystem_Update_Paths> = new Set(),
        public updated_metadata_num: number = 0,
        public updated_metadata: Set<Filesystem_Update_Paths> = new Set(),
        public next_link?: string,
        public delta_link?: string,
    ) { }

    private static serializeSet<T>(s?: Set<T>): any[] {
        if (!s) return [];
        return Array.from(s).map(item => {
            if (item == null) return item;
            const anyItem = item as any;
            if (typeof anyItem.toJson === "function") return anyItem.toJson();
            if (typeof anyItem.toJSON === "function") return anyItem.toJSON();
            if (anyItem instanceof Date) return anyItem.toISOString();
            return anyItem;
        });
    }

    public toJson(): string {
        const obj = {
            target_drive: this.target_drive ?? null,
            date_start: this.date_start ? this.date_start.toISOString() : null,
            date_end: this.date_end ? this.date_end.toISOString() : null,

            created_num: this.created_num,
            created: Array.from(this.created),

            deleted_num: this.deleted_num,
            deleted: Array.from(this.deleted),

            updated_num: this.updated_num,
            updated: Array.from(this.updated),

            updated_metadata_num: this.updated_metadata_num,
            updated_metadata: Array.from(this.updated_metadata),

            next_link: this.next_link ?? null,
            delta_link: this.delta_link ?? null,
        };

        return JSON.stringify(obj, null, 2);
    }

    write(root_path: string): void {
        const updates_dir_path = `${root_path}${LOGS_PATH}/${this.target_drive}`;
        fs.mkdirSync(updates_dir_path, { recursive: true });
        const updates_file_path = `${updates_dir_path}/${formatLogDate(this.date_start)}.json`;

        const drive_dir_path = `${updates_dir_path}/All`
        fs.mkdirSync(drive_dir_path, { recursive: true });
        const drive_file_path = `${drive_dir_path}/${formatLogDate(this.date_start)}.json`;

        this.date_end = new Date();

        removeLogFilesInFolder(updates_dir_path);

        fs.writeFileSync(drive_file_path, this.toJson(), { encoding: "utf-8" });
        fs.writeFileSync(updates_file_path, this.toJson(), { encoding: "utf-8" });
    }

    public static fromJson(input: string): FileSystemUpdate | void {
        let txt: string | null = null;
        try {
            txt = fs.readFileSync(input, "utf8");
        } catch {
            txt = null;
        }
        if (!txt)
            return;

        const raw = JSON.parse(txt);
        const toDate = (v: any) => (v ? new Date(v) : undefined);

        const toSet = (arr: any): Set<Filesystem_Update_Paths> => {
            const s = new Set<Filesystem_Update_Paths>();
            if (!Array.isArray(arr))
                return s;
            for (const item of arr)
                s.add(item as Filesystem_Update_Paths);
            return s;
        };

        const created = toSet(raw.created ?? []);
        const deleted = toSet(raw.deleted ?? []);
        const updated = toSet(raw.updated ?? []);
        const updated_metadata = toSet(raw.updated_metadata ?? []);

        const date_start = toDate(raw.date_start) ?? new Date();
        const date_end = toDate(raw.date_end);

        const instance = new FileSystemUpdate(
            raw.target_drive ?? raw.target_drive ?? undefined,
            date_start,
            date_end,
            typeof raw.created_num === "number" ? raw.created_num : created.size,
            created,
            typeof raw.deleted_num === "number" ? raw.deleted_num : deleted.size,
            deleted,
            typeof raw.updated_num === "number" ? raw.updated_num : updated.size,
            updated,
            typeof raw.updated_metadata_num === "number" ? raw.updated_metadata_num : updated_metadata.size,
            updated_metadata,
            raw.next_link ?? undefined,
            raw.delta_link ?? undefined
        );

        return instance;
    }

    add_update(other: FileSystemUpdate) {
        this.target_drive = this.target_drive ?? other.target_drive;
        this.date_start = this.date_start ?? other.date_start;
        this.date_end = this.date_end ?? other.date_end;
        this.next_link = this.next_link ?? other.next_link;
        this.delta_link = this.delta_link ?? other.delta_link;

        this.created_num = this.created_num + other.created_num;
        this.updated_num = this.updated_num + other.updated_num;
        this.deleted_num = this.deleted_num + other.deleted_num;
        this.updated_metadata_num = this.updated_metadata_num + other.updated_metadata_num;

        this.created = new Set([...this.created, ...other.created]);
        this.updated = new Set([...this.updated, ...other.updated]);
        this.deleted = new Set([...this.deleted, ...other.deleted]);
        this.updated_metadata = new Set([...this.updated_metadata, ...other.updated_metadata]);
    }

    add_document(other: FileSystemDocument | void) {
        if (!other)
            return
        switch (other.state) {
            case FileState.CREATED:
                this.created_num += 1;
                this.created.add(other.file_paths);
                break;
            case FileState.UPDATED:
                this.updated_num += 1;
                this.updated.add(other.file_paths);
                break;
            case FileState.DELETED:
                this.deleted_num += 1;
                this.deleted.add(other.file_paths);
                break;
            case FileState.UPDATED_METADATA:
                this.updated_metadata_num += 1;
                this.updated_metadata.add(other.file_paths);
                break;
            default:
                break;
        }
    }
}

function formatLogDate(d: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `log_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function removeLogFilesInFolder(folderPath: string) {
    if (!fs.existsSync(folderPath)) return;

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
        const fullPath = path.join(folderPath, file);
        if (fs.statSync(fullPath).isFile() && file.toLowerCase().includes("log")) {
            fs.unlinkSync(fullPath);
            console.log(`Deleted: ${fullPath} `);
        }
    }
}

export function introduceNewFile(document: FileSystemDocument, root_folder: string, last_update_date: Date | void): FileSystemDocument | void {
    console.log(document.file_paths);
    switch (document.extension) {
        case 'docx':
        case 'pdf':

            return introduceContentFile(document, root_folder, last_update_date);

            break;
        case 'xlsx':
            return introduceMetadataFile(document, root_folder);
            break;
        default:
            break;
    }
}

function introduceContentFile(document: FileSystemDocument, root_folder: string, last_update_date: Date | void): FileSystemDocument | void {
    if (!document.content)
        return

    const filesystem_dir_path = `${root_folder}${COMPLETE_FILESYSTEM_PATH}${document.file_paths.system_path}`;
    const filesystem_path_metadata = `${filesystem_dir_path}/${DETAILS_NAME}.json`;

    const filesystem_sharepoint_dir_path = `${root_folder}${SHAREPOINT_COPY_PATH}${document.file_paths.sharepoint_path}`;
    const filesystem_sharepoint_path = `${filesystem_sharepoint_dir_path}/${DETAILS_NAME}.json`;

    const filesystem_path_final = `${filesystem_dir_path}/${CONTENT_NAME}.${document.extension}`;

    fs.mkdirSync(filesystem_dir_path, { recursive: true });
    fs.mkdirSync(filesystem_sharepoint_dir_path, { recursive: true });

    let metadata_doc = FileSystemDocument.fromJson(`${filesystem_dir_path}/${DETAILS_NAME}.json`);
    document.addMetadata(metadata_doc);
    if (last_update_date && last_update_date.getTime() < document.last_update_date.getTime()) {
        document.state = FileState.UPDATED;
    } else {
        document.state = FileState.CREATED;
    }

    fs.writeFileSync(filesystem_path_metadata, document.toJson(), { encoding: "utf-8" });
    fs.writeFileSync(filesystem_path_final, document.content, { encoding: "utf-8" });

    fs.writeFileSync(filesystem_sharepoint_path, document.toJson(), { encoding: "utf-8" });
    return document;
}

function introduceMetadataFile(document: FileSystemDocument, root_folder: string): FileSystemDocument | void {
    if (!document.content)
        return;

    const filesystem_dir_path = `${root_folder}${COMPLETE_FILESYSTEM_PATH}${document.file_paths.system_path}`;
    const filesystem_path_metadata = `${filesystem_dir_path}/${DETAILS_NAME}.json`;

    const filesystem_sharepoint_dir_path = `${root_folder}${SHAREPOINT_COPY_PATH}${document.file_paths.sharepoint_path}`;
    const filesystem_sharepoint_path = `${filesystem_sharepoint_dir_path}/${DETAILS_NAME}.json`;

    fs.mkdirSync(filesystem_dir_path, { recursive: true });
    fs.mkdirSync(filesystem_sharepoint_dir_path, { recursive: true });

    document.metadata = parseMetadata(document.content);

    let content_doc = FileSystemDocument.fromJson(`${filesystem_dir_path}/${DETAILS_NAME}.json`);
    if (content_doc) {
        content_doc.addMetadata(document);
    } else {
        content_doc = document;
    }
    content_doc.state = FileState.UPDATED_METADATA;

    fs.writeFileSync(filesystem_path_metadata, content_doc.toJson(), { encoding: "utf-8" });
    fs.writeFileSync(filesystem_sharepoint_path, content_doc.toJson(), { encoding: "utf-8" });
    return content_doc;

}

function parseMetadata(buffer: Buffer): Metadata {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

    const metadata: Metadata = {};

    for (const row of rows) {
        const key = row[0]?.toString().trim();
        const rawVal = row[1]?.toString().trim() ?? "";

        if (!key) continue;

        const norm = key
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

        if (norm.includes("processo")) {
            metadata.process_number = rawVal;
        } else if (norm.includes("relator")) {
            metadata.judge = rawVal;
        } else if (norm === "data" || norm.includes("data")) {
            console.log(rawVal);

            const dt = parseDate(rawVal);
            if (dt)
                metadata.date = dt;
        } else if (norm.includes("decis")) {
            metadata.decision = rawVal;
        } else if (norm.includes("meio")) {
            metadata.process_mean = rawVal;
        } else if (norm.includes("sec")) {
            metadata.section = rawVal;
        } else if (norm.includes("area")) {
            metadata.area = rawVal;
        } else if (norm.includes("descritor")) {
            metadata.descriptors = [];
            for (const cell of row.slice(1)) {
                const v = cell?.toString().trim();
                if (v)
                    metadata.descriptors.push(v);
            }
        }
    }
    return metadata;
}

function parseDate(s: string): Date | undefined {
    const m = s.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return undefined;

    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);

    return new Date(year, month, day);
}

export function findLastUpdate(root_path: string, drive_name: string): string | void {
    const folder_path = `${root_path}${LOGS_PATH}/${drive_name}`;
    if (!fs.existsSync(folder_path))
        return;

    const files = fs.readdirSync(folder_path);
    for (const file of files) {
        const fullPath = path.join(folder_path, file);
        if (fs.statSync(fullPath).isFile() && file.toLowerCase().includes("log")) {
            return fullPath;
        }
    }

    return;
}