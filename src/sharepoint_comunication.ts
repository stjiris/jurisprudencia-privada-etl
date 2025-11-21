import { ClientSecretCredential } from '@azure/identity';
import { Client, PageCollection } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { envOrFail } from './aux';
import { DriveItem } from '@microsoft/microsoft-graph-types';
import { FileSystemDocument, FileSystemUpdate, generateFileSystemPath, generateRelPath, introduceNewFile } from './filesystem';
import { report, Report } from './report/report';
import { response } from 'express';

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

export async function initialUpdateDrive(
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
  let next: string | undefined = initialPathOrUrl;
  let pages = 0;

  let update: FileSystemUpdate = new FileSystemUpdate();

  while (next && pages < MAX_PAGES) {
    const normalized = normalizeGraphUrlToPath(next);
    const resp = await client.api(normalized).get();

    update.add(await retrieveSharepointDocuments(client, resp, drive_name, drive_id, root_path));

    if (update.delta_link)
      return update;
    if (update.next_link) {
      next = update.next_link;
      pages += 1;
      continue;
    }

    return update;
  }

  if (pages >= MAX_PAGES) {
    throw new Error("Exceeded max number of delta pages while retrieving @odata.deltaLink");
  }

  return update;
}

async function retrieveSharepointDocuments(client: Client, resp: any, drive_name: string, drive_id: string, root_path: string): Promise<FileSystemUpdate> {
  let update: FileSystemUpdate = new FileSystemUpdate();

  for (const drive_item of resp.value) {
    const name = drive_item.name;
    if (drive_item.file) {
      const sharepoint_id = drive_item.id;
      const sharepoint_path = drive_item.parentReference.path;
      const created_date = drive_item.createdDateTime;
      const last_modified_date = drive_item.lastModifiedDateTime;
      const sharepoint_url = drive_item.webUrl
      const original_name = drive_item.name;
      const xor_hash = drive_item.file.hashes.quickXorHash;
      const size = drive_item.size

      const sharepoint_path_rel = generateRelPath(sharepoint_path, drive_id, drive_name);
      const metadata = await getMetadata(client, sharepoint_path, original_name);
      const filesystem_path = generateFileSystemPath(metadata)

      const filesystemDocument = new FileSystemDocument(sharepoint_id,
        sharepoint_path,
        sharepoint_path_rel,
        created_date,
        last_modified_date,
        sharepoint_url,
        original_name,
        xor_hash,
        size,
        drive_name,
        drive_id,
        filesystem_path
      );

      introduceNewFile(filesystemDocument, root_path);

      console.log(name);
      console.log("drive_item: ")
      console.log(drive_item);

    }
  }

  return update;
}

async function getMetadata(client: Client, sharepoint_path: string, original_name: string) {
  // TODO get content of the metadata file in the same folder as the content file
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