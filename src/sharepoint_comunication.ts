import { ClientSecretCredential } from '@azure/identity';
import { Client, PageCollection } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { envOrFail } from './aux';
import { DriveItem } from '@microsoft/microsoft-graph-types';
import { FileState, FileSystemDocument, FileSystemUpdate, findLastUpdate, generateRelPath, introduceNewFile } from './filesystem';
import { report, Report } from './report/report';
import { response } from 'express';

const SECTIONTOAREA: Record<string, string> = {
	"1ª Secção": "Judicial - Acórdãos Cível",
	"2ª Secção": "Judicial - Acórdãos Cível",
	"3ª Secção": "Judicial - Acórdãos Criminal",
	"4ª Secção": "Judicial - Acórdãos Social",
	"5ª Secção": "Judicial - Acórdãos Criminal",
	"6ª Secção": "Judicial - Acórdãos Cível",
	"7ª Secção": "Judicial - Acórdãos Cível",
	"Contencioso": "Contencioso",
};


export function initializeGraphClient(tenantId: string, clientId: string, clientSecret: string): Client {
	const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
	const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: ['https://graph.microsoft.com/.default'] });
	const client = Client.initWithMiddleware({ authProvider });
	return client;
}

export async function getDrivesIds(client: Client, site_id: string, drive_names: string[]): Promise<Record<string, string>> {
	const result = await client.api(`/sites/${site_id}/drives`).select("id,name").get();
	type Drive = { id: string; name: string };
	const all_drives = (result.value ?? []) as Array<Drive>;

	const drives = all_drives.filter((d) => d && d.name && d.id && drive_names.includes(d.name));
	const drives_dict = drives.reduce<Record<string, string>>((acc, drive) => {
		if (drive.name) acc[drive.name] = drive.id;
		return acc;
	}, {});

	return drives_dict;
}

export async function updateDrive(
	drive_name: string,
	drive_id: string,
	root_path: string,
	client: Client,
	site_id: string): Promise<FileSystemUpdate> {

	const startPath = `/sites/${encodeURIComponent(site_id)}/drives/${encodeURIComponent(drive_id)}/root/delta`;

	return await updateDriveAux(client, startPath, drive_name, drive_id, root_path);
}

function normalizeGraphUrlToPath(url: string): string {
	if (url.startsWith("/")) return url;
	return url.replace(/^https?:\/\/graph\.microsoft\.com(\/v1\.0|\/beta)?/, "");
}

async function updateDriveAux(client: Client, initialPathOrUrl: string, drive_name: string, drive_id: string, root_path: string): Promise<FileSystemUpdate> {
	const MAX_PAGES = 100;
	let pages = 0;

	const previous_update_path = findLastUpdate(root_path, drive_name);
	const previous_update = previous_update_path ? FileSystemUpdate.fromJson(previous_update_path) ?? undefined : undefined;
	let update: FileSystemUpdate = new FileSystemUpdate(drive_name);
	let next: string | undefined = previous_update ? previous_update.next_link ?? previous_update.delta_link ?? initialPathOrUrl : initialPathOrUrl;

	while (next && pages < MAX_PAGES) {
		const normalized = normalizeGraphUrlToPath(next);
		const resp = await client.api(normalized).get();
		update.add_update(await retrieveSharepointDocuments(client, resp, drive_name, drive_id, root_path, previous_update?.date_start));
		update.delta_link = resp["@odata.deltaLink"];
		update.next_link = resp["@odata.nextLink"];

		if (update.delta_link) {
			update.write(root_path);
			return update;
		}
		if (update.next_link) {
			next = update.next_link;
			pages += 1;
			continue;
		}

		return update;
	}

	if (pages >= MAX_PAGES) {
		update.write(root_path);
		return update;
	}

	return update;
}

async function retrieveSharepointDocuments(client: Client, resp: any, drive_name: string, drive_id: string, root_path: string, last_update_date: Date | undefined): Promise<FileSystemUpdate> {

	let update: FileSystemUpdate = new FileSystemUpdate();
	for (const drive_item of resp.value) {
		if (drive_item.deleted)
			continue;
		if (drive_item.file) {
			const sharepoint_id = drive_item.id;
			const sharepoint_path = drive_item.parentReference.path;
			const created_date = drive_item.createdDateTime;
			const last_modified_date = drive_item.lastModifiedDateTime;
			const sharepoint_url = drive_item.webUrl
			const xor_hash = drive_item.file.hashes.quickXorHash;
			const size = drive_item.size
			const full_name = drive_item.name;
			const lastDot = full_name.lastIndexOf(".");
			const original_name = lastDot > 0 ? full_name.slice(0, lastDot) : full_name;
			const extension = lastDot > 0 ? full_name.slice(lastDot + 1) : "";

			const sharepoint_path_rel = generateRelPath(sharepoint_path, drive_id, drive_name);
			const filesystem_path = transformSharepointPathToFilesystemPath(sharepoint_path_rel);
			const content = await getFileFromSharepoint(client, drive_id, sharepoint_id);
			//console.log(filesystem_path)

			const filesystemDocument = new FileSystemDocument(sharepoint_id,
				sharepoint_path,
				created_date,
				last_modified_date,
				sharepoint_url,
				original_name,
				xor_hash,
				size,
				drive_name,
				drive_id,
				`${sharepoint_path_rel}/${original_name}`,
				`${filesystem_path}/${original_name}`,
			);

			filesystemDocument.extension = extension;
			filesystemDocument.content = content;
			update.add_document(introduceNewFile(filesystemDocument, root_path, last_update_date));

			//console.log(name);
			//console.log("drive_item: ")
			//console.log(drive_item);

		}
	}

	return update;
}

/* export async function updateDrive(update: FileSystemUpdate, client: Client, drive_name_delta: [string, string], root_folder: string): Promise<Report> {
  await updateDriveAux(client, drive_name_delta[1], root_folder);
  return {
	created: 0,
	dateEnd: new Date(),
	dateStart: new Date(),
	deleted: 0,
	skiped: 0,
	soft: false,
	target: "",
	updated: 0
  }
} */

async function getFileFromSharepoint(client: Client, drive_id: string, sharepoint_id: string): Promise<Buffer> {
	const webStream = await client
		.api(`/drives/${drive_id}/items/${sharepoint_id}/content`)
		.get();

	const reader = webStream.getReader();
	const chunks: Uint8Array[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}

	return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

function transformSharepointPathToFilesystemPath(sharepoint_path_rel: string): string {
	const path_parts = sharepoint_path_rel.split("/").filter(Boolean);
	let final_path = [];
	switch (path_parts[0]) {
		case "Anonimização":
			const area = SECTIONTOAREA[path_parts[1]] ?? SECTIONTOAREA[path_parts[2]] ?? path_parts[1];
			final_path.push(area);

			const { year: y1, month: m1 } = extractYearMonth(sharepoint_path_rel);
			final_path.push(y1);
			final_path.push(m1);
			return "/" + final_path.join("/");

		case "Jurisprudência":
			return "";
		default:
			return "";
	}
}

function extractYearMonth(path: string, now = new Date()): { year: number; month: string } {
	const re = /(\d{1,2})-(\d{2})(?:-(\d{4}))?/g;
	let lastMatch: RegExpExecArray | null = null;
	let m: RegExpExecArray | null;
	while ((m = re.exec(path)) !== null) lastMatch = m;

	if (!lastMatch) {
		throw new Error(`No date-like segment found in path: "${path}"`);
	}

	const dayStr = lastMatch[1];
	const monthStr = lastMatch[2];
	const yearStr = lastMatch[3];

	const year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();
	const month = monthStr.padStart(2, "0");

	return { year, month };
}