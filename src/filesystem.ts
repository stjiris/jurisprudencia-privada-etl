import { raw } from "body-parser";
import { Report } from "./report/report";
import fs from "fs";
import path from "path";
import XLSX from "xlsx";

export enum FileState { CREATED = "CREATED", UPDATED = "UPDATED", DELETED = "DELETED", UPDATED_METADATA = "UPDATED_METADATA" };
type Filesystem_Update_Paths = { previous_sharepoint_path?: string, sharepoint_path?: string, previous_system_path?: string, system_path: string }
type Metadata = { process_number?: string, judge?: string, decision?: string, process_mean?: string, descriptors?: string[], section?: string; area?: string; date?: Date }

const ACORDAOS_PATH = "/Acordãos"
const COMPLETE_FILESYSTEM_PATH = `${ACORDAOS_PATH}/FileSystem`
const SHAREPOINT_COPY_PATH = `${ACORDAOS_PATH}/Sharepoint`
const LOGS_PATH = "/Updates"

const DETAILS_NAME = "Detalhes"
const ORIGINAL_NAME = "Original"
const UPDATE_NAME = "Update"

export class FileSystemDocument {
    // properties from sharepoint
    drive_name?: string;
    drive_id?: string;
    sharepoint_id?: string;
    sharepoint_path?: string;
    sharepoint_url?: string;
    xor_hash?: string;

    // decision metadata
    content?: Buffer;
    metadata?: Metadata;

    // filesystem metadata
    creation_date: Date;
    last_update_date: Date;
    original_name: string;
    size: number;
    file_paths: Filesystem_Update_Paths;
    extension: string;

    filesystem_date: Date = new Date();
    state: FileState = FileState.CREATED;

    constructor(
        creation_date: Date,
        last_update_date: Date,
        original_name: string,
        size: number,
        filesystem_path: string,
        extension: string
    ) {
        // properties from sharepoint
        this.creation_date = new Date(creation_date);
        this.last_update_date = new Date(last_update_date);
        this.original_name = original_name;
        this.size = size;
        this.file_paths = { system_path: filesystem_path };
        this.extension = extension;
    }

    addSharepointMetadata(drive_name: string, drive_id: string, sharepoint_id: string, sharepoint_path: string, sharepoint_path_rel: string, sharepoint_url?: string, xor_hash?: string, content?: Buffer) {
        this.drive_name = drive_name;
        this.drive_id = drive_id;
        this.sharepoint_id = sharepoint_id;
        this.sharepoint_path = sharepoint_path;
        this.file_paths.sharepoint_path = sharepoint_path_rel;
        this.sharepoint_url = sharepoint_url;
        this.xor_hash = xor_hash;
        this.content = content;
    }

    addMetadata(area?: string, date?: Date, section?: string, process_number?: string, decision?: string, descriptors?: string[], judge?: string, process_mean?: string): void {
        if (!this.metadata) {
            this.metadata = { process_number, area, section, decision, descriptors, judge, process_mean };
            return;
        }
        this.metadata.area = this.metadata.area ?? area;
        this.metadata.date = this.metadata.date ?? date;
        this.metadata.section = this.metadata.section ?? section;
        this.metadata.process_number = this.metadata.process_number ?? process_number;

        this.metadata.decision = this.metadata.decision ?? decision;
        this.metadata.descriptors = this.metadata.descriptors ?? descriptors;
        this.metadata.judge = this.metadata.judge ?? judge;
        this.metadata.process_mean = this.metadata.process_mean ?? process_mean;
    }

    toJson(): string {
        const obj: any = {
            creation_date: this.creation_date,
            last_update_date: this.last_update_date,
            original_name: this.original_name,
            size: this.size,
            extension: this.extension,
            filesystem_date: this.filesystem_date.toISOString(),
            state: this.state,
            file_paths: this.file_paths,
            metadata: this.metadata,

            drive_name: this.drive_name,
            drive_id: this.drive_id,
            sharepoint_id: this.sharepoint_id,
            sharepoint_path: this.sharepoint_path,
            sharepoint_url: this.sharepoint_url,
            xor_hash: this.xor_hash,
        };

        for (const k of Object.keys(obj)) {
            if (obj[k] === undefined) delete obj[k];
        }

        return JSON.stringify(obj, null, 2);
    }

    introduceNewFile(root_folder: string, last_update_date: Date | void): FileSystemDocument | void {
        //console.log(this.file_paths);
        switch (this.extension) {
            case 'docx':
            case 'pdf':
                return this.introduceContentFile(root_folder, last_update_date);

            case 'xlsx':
                return this.introduceMetadataFile(root_folder);
            default:
                break;
        }
    }

    introduceContentFile(root_folder: string, last_update_date: Date | void): FileSystemDocument | void {
        if (!this.content)
            return

        const filesystem_dir_path = `${root_folder}${COMPLETE_FILESYSTEM_PATH}${this.file_paths.system_path}`;
        const filesystem_path_metadata = `${filesystem_dir_path}/${DETAILS_NAME}.json`;

        const filesystem_sharepoint_dir_path = `${root_folder}${SHAREPOINT_COPY_PATH}${this.file_paths.sharepoint_path}`;
        const filesystem_sharepoint_path = `${filesystem_sharepoint_dir_path}/${DETAILS_NAME}.json`;

        const filesystem_path_final = `${filesystem_dir_path}/${ORIGINAL_NAME}.${this.extension}`;

        fs.mkdirSync(filesystem_dir_path, { recursive: true });
        fs.mkdirSync(filesystem_sharepoint_dir_path, { recursive: true });

        let metadata_doc = FileSystemDocument.fromJson(`${filesystem_dir_path}/${DETAILS_NAME}.json`);
        if (metadata_doc && metadata_doc.metadata)
            this.addMetadata(metadata_doc.metadata.area, metadata_doc.metadata.date, metadata_doc.metadata.section, metadata_doc.metadata.process_number, metadata_doc.metadata.decision, metadata_doc.metadata.descriptors, metadata_doc.metadata.judge, metadata_doc.metadata.process_mean);

        if (last_update_date && last_update_date.getTime() < this.last_update_date.getTime()) {
            this.state = FileState.UPDATED;
        } else {
            this.state = FileState.CREATED;
        }

        fs.writeFileSync(filesystem_path_metadata, this.toJson(), { encoding: "utf-8" });
        fs.writeFileSync(filesystem_path_final, this.content, { encoding: "utf-8" });

        fs.writeFileSync(filesystem_sharepoint_path, this.toJson(), { encoding: "utf-8" });
        return this;
    }

    introduceMetadataFile(root_folder: string): FileSystemDocument | void {
        if (!this.content)
            return;

        const filesystem_dir_path = `${root_folder}${COMPLETE_FILESYSTEM_PATH}${this.file_paths.system_path}`;
        const filesystem_path_metadata = `${filesystem_dir_path}/${DETAILS_NAME}.json`;

        const filesystem_sharepoint_dir_path = `${root_folder}${SHAREPOINT_COPY_PATH}${this.file_paths.sharepoint_path}`;
        const filesystem_sharepoint_path = `${filesystem_sharepoint_dir_path}/${DETAILS_NAME}.json`;

        fs.mkdirSync(filesystem_dir_path, { recursive: true });
        fs.mkdirSync(filesystem_sharepoint_dir_path, { recursive: true });

        this.metadata = excelToMetadata(this.content);

        let content_doc = FileSystemDocument.fromJson(`${filesystem_dir_path}/${DETAILS_NAME}.json`);
        if (content_doc) {
            content_doc.addMetadata(this.metadata?.area, this.metadata?.date, this.metadata?.section, this.metadata?.process_number, this.metadata?.decision, this.metadata?.descriptors, this.metadata?.judge, this.metadata?.process_mean);
        } else {
            content_doc = this;
        }
        content_doc.state = FileState.UPDATED_METADATA;

        fs.writeFileSync(filesystem_path_metadata, content_doc.toJson(), { encoding: "utf-8" });
        fs.writeFileSync(filesystem_sharepoint_path, content_doc.toJson(), { encoding: "utf-8" });
        return content_doc;

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

        const doc = new FileSystemDocument(toDate(raw_json.creation_date),
            toDate(raw_json.last_update_date),
            raw_json.original_name ?? "",
            raw_json.size ?? 0,
            raw_json.file_paths?.system_path ?? "",
            raw_json.extension ?? ""
        )
        doc.file_paths = raw_json.file_paths ?? doc.file_paths;

        doc.drive_name = raw_json.drive_name ?? doc.drive_name;
        doc.drive_id = raw_json.drive_id ?? doc.drive_id;
        doc.sharepoint_id = raw_json.sharepoint_id ?? doc.sharepoint_id;
        doc.sharepoint_path = raw_json.sharepoint_path ?? doc.sharepoint_path;
        doc.sharepoint_url = raw_json.sharepoint_url ?? doc.sharepoint_url;
        doc.xor_hash = raw_json.xor_hash ?? doc.xor_hash;

        doc.filesystem_date = toDate(raw_json.filesystem_date);
        doc.metadata = raw_json.metadata ?? {};
        doc.state = raw_json.state ?? doc.state;

        return doc;

    }

}

// TODO


export class FileSystemUpdate {
    constructor(
        public target_drives?: Set<string>,
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
            target_drives: this.target_drives ? Array.from(this.target_drives) : null,
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
        if (!this.target_drives)
            return;
        for (const drive of this.target_drives) {
            const updates_dir_path = `${root_path}${LOGS_PATH}/${drive}`;
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
        if (this.target_drives && other.target_drives) {
            this.target_drives = new Set([...this.target_drives, ...other.target_drives]);
        } else {
            this.target_drives = this.target_drives ?? other.target_drives;
        }

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

    add_document(document: FileSystemDocument | void) {
        if (!document)
            return
        switch (document.state) {
            case FileState.CREATED:
                this.created_num += 1;
                this.created.add(document.file_paths);
                break;
            case FileState.UPDATED:
                this.updated_num += 1;
                this.updated.add(document.file_paths);
                break;
            case FileState.DELETED:
                this.deleted_num += 1;
                this.deleted.add(document.file_paths);
                break;
            case FileState.UPDATED_METADATA:
                this.updated_metadata_num += 1;
                this.updated_metadata.add(document.file_paths);
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
    if (!fs.existsSync(folderPath))
        return;

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
        const fullPath = path.join(folderPath, file);
        if (fs.statSync(fullPath).isFile() && file.toLowerCase().includes("log")) {
            fs.unlinkSync(fullPath);
            console.log(`Deleted: ${fullPath} `);
        }
    }
}

function excelToMetadata(buffer: Buffer): Metadata {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

    const metadata: Metadata = {};

    for (const row of rows) {
        const key = row[0]?.toString().trim();
        const rawVal = row[1]?.toString().trim() ?? "";

        if (!key)
            continue;

        const norm = key
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();

        if (norm.includes("processo")) {
            metadata.process_number = rawVal;
        } else if (norm.includes("relator")) {
            metadata.judge = rawVal;
        } else if (norm.includes("data")) {
            const dt = parseExcelSerial(rawVal);
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

function parseExcelSerial(s: string | number): Date | undefined {
    const n = typeof s === "number" ? s : Number(s);
    if (!Number.isFinite(n)) return undefined;

    const epoch = Date.UTC(1899, 11, 31);
    const whole = Math.floor(n);
    const frac = n - whole;
    const days = whole > 59 ? whole - 1 : whole;
    const ms = days * 86400000 + Math.round(frac * 86400000);

    return new Date(epoch + ms);
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

export function loadContentFile(root_path: string, folder_path: string): string | void {
    const actual_path = `${root_path}${COMPLETE_FILESYSTEM_PATH}${folder_path}`;
    const entries = fs.readdirSync(actual_path);

    for (const entry of entries) {
        const fullPath = path.join(actual_path, entry);

        if (!fs.statSync(fullPath).isFile())
            continue;

        const base = path.parse(entry).name;

        if (base === ORIGINAL_NAME) {
            return fullPath;
        }
    }
}

export function loadMetadataFile(root_path: string, folder_path: string): FileSystemDocument | void {
    const actual_path = `${root_path}${COMPLETE_FILESYSTEM_PATH}${folder_path}`;
    const entries = fs.readdirSync(actual_path);

    for (const entry of entries) {
        const fullPath = path.join(actual_path, entry);

        if (!fs.statSync(fullPath).isFile())
            continue;

        const base = path.parse(entry).name;

        if (base === DETAILS_NAME) {
            return FileSystemDocument.fromJson(fullPath);
        }
    }
}