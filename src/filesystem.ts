import { Report } from "./report/report";

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
    sharepoint_path_rel: string;

    // filesystem properties
    filesystem_path: string;
    filesystem_date: Date;

    constructor(
        sharepoint_id: string,
        sharepoint_path: string,
        sharepoint_path_rel: string,
        creation_date: Date,
        last_update_date: Date,
        sharepoint_url: string,
        original_name: string,
        xor_hash: string,
        size: number,
        drive_name: string,
        drive_id: string,
        filesystem_path: string
    ) {
        this.sharepoint_id = sharepoint_id;
        this.sharepoint_path = sharepoint_path;
        this.sharepoint_path_rel = sharepoint_path_rel;
        this.creation_date = creation_date;
        this.last_update_date = last_update_date;
        this.sharepoint_url = sharepoint_url;
        this.original_name = original_name;
        this.xor_hash = xor_hash;
        this.size = size;

        this.drive_name = drive_name;
        this.drive_id = drive_id;
        this.filesystem_path = filesystem_path;
        this.filesystem_date = new Date();

    }


}

// TODO
export function generateRelPath(sharepoint_path: string, drive_id: string, drive_name: string): string {
    return sharepoint_path;
}

// TODO
export function generateFileSystemPath(metadata: any): string {
    return "";
}




// TODO
export class FileSystemUpdate {
    constructor(
        public target_drives?: string[],
        public date_start?: Date,
        public date_end?: Date,
        public created_num: number = 0,
        public created: Set<string> = new Set(),
        public updated_num: number = 0,
        public updated: Set<string> = new Set(),
        public deleted_num: number = 0,
        public deleted: Set<string> = new Set(),
        public next_link?: string,
        public delta_link?: string,
    ) { }

    add(other: FileSystemUpdate): FileSystemUpdate {
        const target_drives = this.target_drives ?? other.target_drives;
        const date_start = this.date_start ?? other.date_start;
        const date_end = this.date_end ?? other.date_end;
        const next_link = this.next_link ?? other.next_link;
        const delta_link = this.delta_link ?? other.delta_link;

        const created_num = this.created_num + other.created_num;
        const updated_num = this.updated_num + other.updated_num;
        const deleted_num = this.deleted_num + other.deleted_num;

        const created = new Set([...this.created, ...other.created]);
        const updated = new Set([...this.updated, ...other.updated]);
        const deleted = new Set([...this.deleted, ...other.deleted]);

        return new FileSystemUpdate(
            target_drives,
            date_start,
            date_end,
            created_num,
            created,
            updated_num,
            updated,
            deleted_num,
            deleted,
            next_link,
            delta_link
        );
    }
}

// TODO
export function introduceNewFile(document: FileSystemDocument, root_folder: string) {

}
