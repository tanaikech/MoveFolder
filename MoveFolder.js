/**
 * GitHub  https://github.com/tanaikech/MoveFolder<br>
 * Library name
 * @type {string}
 * @const {string}
 * @readonly
 */
const appName = "MoveFolder";

/**
 * ### Description
 * Check whether Drive API is enabled at Advanced Google services, and return it as true or false and the version.
 * ref: https://medium.com/google-cloud/checking-api-enabled-with-advanced-google-services-using-google-apps-script-572bcdeb39a8
 *
 * @param {String} apiName API name you want to check.
 * @returns {Object} Object including "api" and "version" properties.
 */
function isAPIAtAdvancedGoogleServices_(apiName) {
  if (!apiName || typeof apiName !== "string" || apiName.trim() === "") {
    throw new Error("Please set a valid API name.");
  }

  apiName = apiName.charAt(0).toUpperCase() + apiName.slice(1);
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
    if (url === null || obj === null || typeof url !== "string") {
      throw new Error("Please provide a valid URL and query parameters.");
    }
    return (
      (url === "" ? "" : `${url}?`) +
      Object.entries(obj)
        .flatMap(([k, v]) =>
          Array.isArray(v)
            ? v.map((e) => `${k}=${encodeURIComponent(e)}`)
            : `${k}=${encodeURIComponent(v)}`,
        )
        .join("&")
    );
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
      const res = UrlFetchApp.fetch(addQueryParameters(url, query), {
        headers,
      });
      const obj = JSON.parse(res.getContentText());
      if (obj.files && obj.files.length > 0) {
        files.push(...obj.files);
      }
      pageToken = obj.nextPageToken;
      query.pageToken = pageToken;
    } while (pageToken);

    const temp = [];
    const p = parents.slice();
    p.push(id);
    files.forEach((e) => {
      temp.push({ name: e.name, id: e.id, parent: e.parents[0], tree: p });
    });

    if (temp.length > 0) {
      folders.temp.push(temp);
      temp.forEach((e) => {
        getAllFolders(e.id, e.tree, folders);
      });
    }
    return folders;
  };

  // Retrieve folder tree.
  const res = UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files/${srcFolderId}?supportsAllDrives=true&fields=id%2Cname`,
    { headers },
  );
  const topFolder = JSON.parse(res.getContentText());
  const objFolders = getAllFolders(srcFolderId);
  const { id, id2Name } = objFolders.temp.reduce(
    (o, e) => {
      e.forEach(({ name, id: folderId, tree }) => {
        o.id.push([...tree, folderId]);
        o.id2Name[folderId] = name;
      });
      return o;
    },
    { id: [[topFolder.id]], id2Name: { [topFolder.id]: topFolder.name } },
  );

  const name = id.map((e) => e.map((f) => id2Name[f]));
  const folderTree = { id, name };

  // Retrieve files from each folder using fetchAll for better performance.
  let remainingFolders = folderTree.id.map((r, i) => ({
    folderTreeById: r,
    folderTreeByName: folderTree.name[i],
    folderId: r[r.length - 1],
    pageToken: "",
    filesInFolder: [],
  }));

  const files = [];

  while (remainingFolders.length > 0) {
    const requests = remainingFolders.map((f) => {
      const query = {
        q: `'${f.folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(parents,id),nextPageToken",
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      };
      if (f.pageToken) query.pageToken = f.pageToken;
      return { url: addQueryParameters(url, query), headers };
    });

    const responses = UrlFetchApp.fetchAll(requests);
    const nextRemaining = [];

    responses.forEach((res, i) => {
      const respObj = JSON.parse(res.getContentText());
      const f = remainingFolders[i];
      if (respObj.files && respObj.files.length > 0) {
        f.filesInFolder.push(...respObj.files);
      }
      if (respObj.nextPageToken) {
        f.pageToken = respObj.nextPageToken;
        nextRemaining.push(f);
      } else {
        files.push({
          folderTreeById: f.folderTreeById,
          folderTreeByName: f.folderTreeByName,
          filesInFolder: f.filesInFolder,
        });
      }
    });
    remainingFolders = nextRemaining;
  }
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
  const {
    srcFolderId,
    dstFolderId,
    accessToken = ScriptApp.getOAuthToken(),
    forSharedDrive = false,
  } = object;

  const headers = { authorization: "Bearer " + accessToken };

  // Check source folder.
  console.log("Checking source and destination folders...");
  const checkSharedDrive_ = (folderId) => {
    const res = UrlFetchApp.fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true&fields=driveId`,
      { headers, muteHttpExceptions: true },
    );
    if (res.getResponseCode() !== 200) return false;
    const obj = JSON.parse(res.getContentText());
    return "driveId" in obj;
  };

  if (
    forSharedDrive === false &&
    ![srcFolderId, dstFolderId].some((id) => checkSharedDrive_(id))
  ) {
    console.log(
      "Moving folders within standard Drive (no shared drive involved).",
    );
    const options = { method: "PATCH", headers, muteHttpExceptions: true };
    const res = UrlFetchApp.fetch(
      `https://www.googleapis.com/drive/v3/files/${srcFolderId}?supportsAllDrives=true&enforceSingleParent=true&addParents=${dstFolderId}`,
      options,
    );

    if (res.getResponseCode() !== 200) {
      console.error(`Failed to move folder: ${res.getContentText()}`);
    } else {
      console.log("Process completed successfully.");
    }
    return;
  }

  // Retrieve file list with the subfolders.
  console.log("Shared drive involved or forced flag enabled.");
  console.log("Retrieving file list including subfolders...");
  const obj = listFolders_({ headers, srcFolderId });
  if (obj.files.length === 0) {
    console.warn("No files found to move.");
    return;
  }

  // Create folder tree in the destination folder.
  console.log("Creating folder tree in the destination folder...");
  const tree = obj.files.map(({ folderTreeById, folderTreeByName }) => ({
    folderTreeById,
    folderTreeByName,
  }));
  const newFolders = {};
  const maxDepth = Math.max(...tree.map((t) => t.folderTreeById.length));

  for (let depth = 0; depth < maxDepth; depth++) {
    const foldersToCreate = [];
    const seen = new Set();

    tree.forEach(({ folderTreeById, folderTreeByName }) => {
      if (folderTreeById.length > depth) {
        const originalId = folderTreeById[depth];
        if (!seen.has(originalId) && !newFolders[originalId]) {
          seen.add(originalId);
          const name = folderTreeByName[depth];
          const parent =
            depth === 0
              ? dstFolderId
              : newFolders[folderTreeById[depth - 1]].id;
          foldersToCreate.push({ originalId, name, parent });
        }
      }
    });

    if (foldersToCreate.length > 0) {
      const requests = foldersToCreate.map((f) => ({
        url: "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
        method: "POST",
        headers,
        contentType: "application/json",
        payload: JSON.stringify({
          name: f.name,
          parents: [f.parent],
          mimeType: MimeType.FOLDER,
        }),
      }));

      const responses = UrlFetchApp.fetchAll(requests);
      responses.forEach((res, i) => {
        const respObj = JSON.parse(res.getContentText());
        const f = foldersToCreate[i];
        newFolders[f.originalId] = { id: respObj.id, name: f.name };
      });
    }
  }

  // Create request body for moving files.
  console.log("Creating request body for moving files...");
  const allFolders = [
    ...new Set(obj.files.flatMap(({ folderTreeById }) => folderTreeById)),
  ];
  const filesList = obj.files.map(({ folderTreeById, filesInFolder }) => ({
    srcFolder: folderTreeById[folderTreeById.length - 1],
    srcFiles: filesInFolder
      .filter(({ id }) => !allFolders.includes(id))
      .map(({ id }) => id),
  }));

  const { moveRequests, err } = filesList.reduce(
    (o, { srcFolder, srcFiles }) => {
      if (newFolders[srcFolder]) {
        if (srcFiles.length > 0) {
          srcFiles.forEach((fileId) =>
            o.moveRequests.push({
              method: "PATCH",
              endpoint: `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&enforceSingleParent=true&addParents=${newFolders[srcFolder].id}`,
              requestBody: {},
            }),
          );
        }
      } else {
        o.err.push(`"${srcFolder}" is not included in newFolders.`);
      }
      return o;
    },
    { err: [], moveRequests: [] },
  );

  if (err.length > 0) {
    console.warn("Warnings during folder mapping:", err);
  }

  // Execute file move requests.
  if (moveRequests.length === 0) {
    console.warn("No files found to move.");
  } else {
    console.log("Moving files using batch requests...");
    const moveResponses = EDo({
      batchPath: "batch/drive/v3",
      requests: moveRequests,
      accessToken,
    });

    // Validate if any move request failed (to prevent data loss)
    const moveErrors = [];
    moveResponses.forEach((res, i) => {
      if (typeof res === "string") {
        moveErrors.push(`Request ${i} failed: ${res}`);
      } else if (res && res.error) {
        moveErrors.push(
          `File move failed for endpoint ${moveRequests[i].endpoint}: ${res.error.message}`,
        );
      }
    });

    if (moveErrors.length > 0) {
      console.error("\n[CRITICAL ERROR] Failed to move some files!");
      console.error(
        "To prevent data loss, the source folders will NOT be deleted.",
      );
      console.error(
        `Error details (first 5 errors):\n${moveErrors.slice(0, 5).join("\n")}`,
      );
      if (moveErrors.length > 5) {
        console.error(`...and ${moveErrors.length - 5} more errors.`);
      }
      return null;
    }
    console.log("All files moved successfully.");
  }

  // Delete original source folders only if file moves were completely successful
  if (allFolders.length > 0) {
    console.log("Deleting original source folders...");
    const deleteRequests = allFolders.map((id) => ({
      method: "DELETE",
      endpoint: `https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`,
    }));

    const deleteResponses = EDo({
      batchPath: "batch/drive/v3",
      requests: deleteRequests,
      accessToken,
    });

    const deleteErrors = [];
    deleteResponses.forEach((res, i) => {
      if (typeof res === "string") {
        deleteErrors.push(`Delete failed: ${res}`);
      } else if (res && res.error) {
        deleteErrors.push(
          `Folder delete failed for ${deleteRequests[i].endpoint}: ${res.error.message}`,
        );
      }
    });

    if (deleteErrors.length > 0) {
      console.warn(
        `Some source folders could not be deleted:\n${deleteErrors.slice(0, 5).join("\n")}`,
      );
    } else {
      console.log("Original folders deleted successfully.");
    }
  }

  console.log("Process completed.");
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
  if (
    typeof object !== "object" ||
    !["srcFolderId", "dstFolderId"].every((e) => e in object)
  ) {
    throw new Error(
      "Please provide a valid object with 'srcFolderId' and 'dstFolderId'.",
    );
  }

  // Check Drive API availability.
  console.log("Checking if Drive API is enabled...");
  if (isAPIAtAdvancedGoogleServices_("Drive").api !== "enable") {
    throw new Error(
      "Please enable Drive API v3 at Advanced Google services. ref: https://developers.google.com/apps-script/guides/services/advanced#enable_advanced_services",
    );
  }

  moveFolder_(object);
}

// For directly using this script.
const MoveFolder = { run };
