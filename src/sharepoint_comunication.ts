import { ClientSecretCredential } from '@azure/identity';
import { Client, PageCollection } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { FileSystemDocument, FileSystemUpdate, findLastUpdate } from './filesystem';

const SECTIONTOAREA: Record<string, string> = {
	"1ª Secção": "Área Cível",
	"2ª Secção": "Área Cível",
	"3ª Secção": "Área Criminal",
	"4ª Secção": "Área Social",
	"5ª Secção": "Área Criminal",
	"6ª Secção": "Área Cível",
	"7ª Secção": "Área Cível",
	"Contencioso": "Contencioso",
	"Cnflitos": "Conflitos",
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
	let update: FileSystemUpdate = new FileSystemUpdate(new Set([drive_name]));
	let next: string | undefined = previous_update ? previous_update.next_link ?? previous_update.delta_link ?? initialPathOrUrl : initialPathOrUrl;

	while (next && pages < MAX_PAGES) {
		const normalized = normalizeGraphUrlToPath(next);
		const resp = await client.api(normalized).get();
		update.add_update(await retrieveSharepointDocuments(client, resp, drive_name, drive_id, root_path, previous_update?.date_start));

		update.delta_link = resp["@odata.deltaLink"];
		update.next_link = resp["@odata.nextLink"];

		if (update.delta_link) {
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
		return update;
	}

	return update;
}

async function retrieveSharepointDocuments(client: Client, page_of_documents: any, drive_name: string, drive_id: string, root_path: string, last_update_date: Date | undefined): Promise<FileSystemUpdate> {

	let update: FileSystemUpdate = new FileSystemUpdate();
	for (const drive_item of page_of_documents.value) {
		if (drive_item.deleted)
			continue;
		if (drive_item.file) {
			const sharepoint_id = drive_item.id;
			const sharepoint_path = drive_item.parentReference.path;
			const sharepoint_url = drive_item.webUrl
			const xor_hash = drive_item.file.hashes.quickXorHash;
			const sharepoint_path_rel = generateRelPath(sharepoint_path, drive_id, drive_name);


			const created_date = drive_item.createdDateTime;
			const last_modified_date = drive_item.lastModifiedDateTime;
			const size = drive_item.size
			const full_name = drive_item.name;
			const lastDot = full_name.lastIndexOf(".");
			const original_name = lastDot > 0 ? full_name.slice(0, lastDot) : full_name;
			const extension = lastDot > 0 ? full_name.slice(lastDot + 1) : "";

			const { date: date, section: section, area: area } = extractDataFromPath(sharepoint_path_rel);
			const content = await getFileFromSharepoint(client, drive_id, sharepoint_id);

			if (!date || !area)
				continue;
			const filesystem_path = `/${area}/${date.getFullYear()}/${date.getMonth() + 1}/${date.getDay()}`

			const filesystemDocument = new FileSystemDocument(created_date,
				last_modified_date,
				original_name,
				size,
				`${filesystem_path}/${original_name}`,
				extension
			);

			filesystemDocument.addSharepointMetadata(drive_name, drive_id, sharepoint_id, sharepoint_path, `${sharepoint_path_rel}/${original_name}`, sharepoint_url, xor_hash, content);
			filesystemDocument.addMetadata(area, date, section);
			console.log(filesystemDocument.file_paths);
			update.add_document(filesystemDocument.introduceNewFile(root_path, last_update_date));
		}
	}

	return update;
}

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

function extractDataFromPath(path: string): { date?: Date, section?: string, area?: string } {
	const result: { date?: Date; section?: string; area?: string } = {};

	const matches = [...path.matchAll(/(\d{1,2})-(\d{2})(?:-(\d{4}))?/g)];
	const last = matches.at(-1);

	if (last) {
		const day = Number(last[1]);
		const month = Number(last[2]);
		const year = Number(last[3] ?? new Date().getFullYear());
		result.date = new Date(year, month - 1, day);
	}

	const lower = path.toLowerCase();
	for (const key of Object.keys(SECTIONTOAREA)) {
		if (lower.includes(key.toLowerCase())) {
			result.section = key;
			result.area = SECTIONTOAREA[key];
			break;
		}
	}

	return result;
}

function generateRelPath(sharepoint_path: string, drive_id: string, drive_name: string): string {
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
