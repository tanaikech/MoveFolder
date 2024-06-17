/**
 * GitHub  https://github.com/tanaikech/MoveFolder<br>
 * Library name
 * @type {string}
 * @const {string}
 * @readonly
 */
var appName = "MoveFolder";


/**
 * ### Description
 * Check whether Drive API is enabled at Advanced Google services, and return it as true or false and the version.
 * ref: https://medium.com/google-cloud/checking-api-enabled-with-advanced-google-services-using-google-apps-script-572bcdeb39a8
 *
 * @param {String} apiName API name you want to check.
 * @returns {Object} Object including "api" and "version" properties.
 */
function isAPIAtAdvancedGoogleServices_(apiName) {
  if (!apiName || apiName == "" || typeof apiName != "string") {
    throw new Error("Please set a valid API name.");
  } else if (!/^[A-Z]+$/g.test(apiName[0])) {
    const [t, ...b] = apiName;
    apiName = [t.toUpperCase(), ...b].join("");
  }
  const obj = { apiName, api: "disable" };
  if (typeof this[apiName] !== "undefined") {
    obj.api = "enable";
    obj.version = this[apiName].getVersion();
  }
  return obj;
}

/**
 * ### Description
 * Retrieve file list including subfolders.
 * 
 * @param {Object} object Object for using this method.
 * @param {String} object.headers Request header.
 * @param {String} object.srcFolderId Source folder ID.
 * @returns {Object} Object including the retrieved file list.
 */
function listFolders_(object) {
  const { headers, srcFolderId } = object;

  // ref: https://github.com/tanaikech/UtlApp?tab=readme-ov-file#addqueryparameters
  function addQueryParameters(url, obj) {
    if (url === null || obj === null || typeof url != "string") {
      throw new Error("Please give URL (String) and query parameter (JSON object).");
    }
    return (url == "" ? "" : `${url}?`) + Object.entries(obj).flatMap(([k, v]) => Array.isArray(v) ? v.map(e => `${k}=${encodeURIComponent(e)}`) : `${k}=${encodeURIComponent(v)}`).join("&");
  }

  const url = "https://www.googleapis.com/drive/v3/files";

  const getAllFolders = (id, parents = [], folders = { temp: [] }) => {
    const query = {
      q: `'${id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name,parents),nextPageToken",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    };
    const files = [];
    let pageToken = "";
    do {
      const res = UrlFetchApp.fetch(addQueryParameters(url, query), { headers });
      const obj = JSON.parse(res.getContentText());
      if (obj.files.length > 0) {
        files.push(...obj.files);
      }
      pageToken = obj.nextPageToken;
      query.pageToken = pageToken;
    } while (pageToken)
    const temp = [];
    const p = parents.slice();
    p.push(id);
    files.forEach(e => {
      temp.push({ "name": e.name, "id": e.id, "parent": e.parents[0], "tree": p });
    });
    if (temp.length > 0) {
      folders.temp.push(temp);
      temp.forEach(e => {
        getAllFolders(e.id, e.tree, folders);
      });
    }
    return folders;
  }

  // Retrieve folder tree.
  const res = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${srcFolderId}?supportsAllDrives=true&fields=id%2Cname`, { headers });
  const topFolder = JSON.parse(res.getContentText());
  const obj = getAllFolders(srcFolderId);
  const { id, id2Name } = obj.temp.reduce((o, e) => {
    e.forEach(({ name, id, tree }) => {
      o.id.push([...tree, id]);
      o.id2Name = { ...o.id2Name, [id]: name };
    });
    return o;
  }, { id: [[topFolder.id]], id2Name: { [topFolder.id]: topFolder.name } });
  const name = id.map(e => e.map(f => id2Name[f]));
  const folderTree = { id, name };

  // Retrieve files from each folder.
  const files = folderTree.id.map((r, i) => {
    const id = r[r.length - 1];
    const query = {
      q: `'${id}' in parents and trashed=false`,
      fields: "files(parents,id),nextPageToken",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    };
    const files = [];
    let pageToken = "";
    do {
      const res = UrlFetchApp.fetch(addQueryParameters(url, query), { headers });
      const obj = JSON.parse(res.getContentText());
      if (obj.files.length > 0) {
        files.push(...obj.files);
      }
      pageToken = obj.nextPageToken;
      query.pageToken = pageToken;
    } while (pageToken);
    return {
      folderTreeById: r,
      folderTreeByName: folderTree.name[i],
      filesInFolder: files
    };
  });
  return { files };
}

/**
 * ### Description
 * Move folder including files and folders from the source folder to the destination folder.
 * 
 * @param {Object} object Object for using this method.
 * @param {String} object.srcFolderId Source folder ID.
 * @param {String} object.dstFolderId Destination folder ID.
 * @param {String} object.accessToken Access token.
 * @param {Boolean} object.forSharedDrive Default is false.
 * @returns {void}
 */
function moveFolder_(object) {
  let { srcFolderId, dstFolderId, accessToken = ScriptApp.getOAuthToken(), forSharedDrive = false } = object;

  const headers = { authorization: "Bearer " + accessToken };

  // Check source folder.
  console.log("Check source folder.");
  const checkSharedDrive_ = folderId => {
    const res = UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true&fields=driveId`, { headers });
    const obj = JSON.parse(res.getContentText());
    return "driveId" in obj;
  }
  if (forSharedDrive === false && ![srcFolderId, dstFolderId].some(id => checkSharedDrive_(id))) {
    console.log("Move in no shared drive.");
    UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${srcFolderId}?supportsAllDrives=true&enforceSingleParent=true&addParents=${dstFolderId}`, { method: "PATCH", headers });
    console.log("Done.");
    return;
  }

  // Retrieve file list with the subfolders.
  console.log("Move in the shared drive.");
  console.log(`Retrieve file list with the subfolders.`);
  const obj = listFolders_({ headers, srcFolderId });
  if (obj.files.length == 0) {
    console.warn("No files.");
    return;
  }

  // Create folder tree to the destination folder.
  console.log(`Create folder tree to the destination folder.`);
  const tree = obj.files.map(({ folderTreeById, folderTreeByName }) => ({ folderTreeById, folderTreeByName }));
  const newFolders = tree.reduce((o, { folderTreeById, folderTreeByName }) => {
    folderTreeByName.forEach((name, j) => {
      const parent = j == 0 ? dstFolderId : o[folderTreeById[j - 1]].id;
      if (!Object.entries(o).some(([k, v]) => k == folderTreeById[j] && v.name == name)) {
        const options = {
          headers,
          contentType: "application/json",
          payload: JSON.stringify({ name, parents: [parent], mimeType: MimeType.FOLDER })
        };
        const res = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", options);
        const { id } = JSON.parse(res.getContentText());
        o[folderTreeById[j]] = { id, name };
      }
    });
    return o;
  }, {});

  // Create request body for moving files.
  console.log(`Create request body for moving files.`);
  const allFolders = [...new Set(obj.files.flatMap(({ folderTreeById }) => folderTreeById))];
  const files = obj.files.map(({ folderTreeById, filesInFolder }) => ({ srcFolder: folderTreeById.pop(), srcFiles: filesInFolder.filter(({ id }) => !allFolders.includes(id)).map(({ id }) => id) }));
  const { requests, err } = files.reduce((o, { srcFolder, srcFiles }) => {
    if (newFolders[srcFolder]) {
      if (srcFiles.length > 0) {
        srcFiles.forEach(fileId => o.requests.push({
          method: "PATCH",
          endpoint: `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&enforceSingleParent=true&addParents=${newFolders[srcFolder].id}`,
          requestBody: {},
        }));
      }
    } else {
      o.err.push(`"${srcFolder}" is not included in newFolders.`);
    }
    return o;
  }, { err: [], requests: [] });
  if (err.length > 0) {
    console.warn(err);
  }
  if (requests.length == 0) {
    console.warn("Files for moving are not found.");
    return null;
  }
  if (allFolders.length > 0) {
    const addRequests = allFolders.map(id => ({
      method: "DELETE",
      endpoint: `https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`
    }));
    requests.push(...addRequests);
  }

  // Move folder including files and folders with batch requests.
  console.log(`Move folder including files and folders with batch requests.`);
  EDo({ batchPath: "batch/drive/v3", requests, accessToken });

  console.log("Done.");
}

/**
 * ### Description
 * This is the main method. Move folder including files and folders from the source folder to the destination folder.
 * 
 * ### Sample script
 *
 * ```javascript
 * const object = {srcFolderId: "###", dstFolderId: "###", accessToken: "###"};
 * MoveFolder.run(object);
 * ```
 * 
 * - srcFolderId: Required
 * - dstFolderId: Required
 * - accessToken: Default is ScriptApp.getOAuthToken(). If you want to use the access token from the service account, please use this.
 * 
 * @param {Object} object Object for using this method.
 * @param {String} object.srcFolderId Source folder ID.
 * @param {String} object.dstFolderId Destination folder ID.
 * @param {String} object.accessToken Access token.
 * @param {Boolean} object.forSharedDrive Default is false.
 * @returns {void}
 */
function run(object) {
  if (typeof object != "object" || !["srcFolderId", "dstFolderId"].every(e => e in object)) {
    throw new Error("Please give valid object.");
  }

  // Check Drive API.
  console.log("Check Drive API.");
  if (isAPIAtAdvancedGoogleServices_("Drive").api != "enable") {
    throw new Error("Please enable Drive API v3 at Advanced Google services. ref: https://developers.google.com/apps-script/guides/services/advanced#enable_advanced_services");
  }

  moveFolder_(object);
}

// For directly using this script.
const MoveFolder = { run };
