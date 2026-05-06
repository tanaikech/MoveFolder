/**
 * Test function for the MoveFolder script.
 * This script runs entirely within a single function. It creates temporary
 * test folders and files, runs the MoveFolder logic, compares the folder
 * structures before and after the move, and then cleans up all generated
 * assets automatically in the 'finally' block.
 */
function testMoveFolder() {
  console.log("--- Start MoveFolder Test ---");
  const token = ScriptApp.getOAuthToken();
  const headers = { Authorization: "Bearer " + token };

  // Helper function to easily call Drive API
  const fetchAPI = (url, method, payload) => {
    const options = {
      method: method,
      headers: headers,
      muteHttpExceptions: true,
    };
    if (payload) {
      options.contentType = "application/json";
      options.payload = JSON.stringify(payload);
    }
    const res = UrlFetchApp.fetch(url, options);
    if (res.getResponseCode() >= 300) {
      throw new Error("API Error: " + res.getContentText());
    }
    return JSON.parse(res.getContentText());
  };

  // Helper function to retrieve the folder tree as an array of relative paths
  const getTree = (folderId, currentPath = "") => {
    let paths = [];
    let pageToken = "";
    do {
      const query = `'${folderId}' in parents and trashed = false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType),nextPageToken&pageSize=1000`;
      const res = UrlFetchApp.fetch(url, {
        headers: headers,
        muteHttpExceptions: true,
      });
      const obj = JSON.parse(res.getContentText());

      if (obj.files) {
        for (const file of obj.files) {
          const itemPath = currentPath + "/" + file.name;
          const type =
            file.mimeType === MimeType.FOLDER ? "[Folder]" : "[File]";
          paths.push(`${type} ${itemPath}`);

          // Recursively get structure for subfolders
          if (file.mimeType === MimeType.FOLDER) {
            paths = paths.concat(getTree(file.id, itemPath));
          }
        }
      }
      pageToken = obj.nextPageToken;
    } while (pageToken);

    return paths;
  };

  let srcParentId, dstParentId, newRootId;
  try {
    // 1. Create Source and Destination root folders for testing
    srcParentId = fetchAPI(
      "https://www.googleapis.com/drive/v3/files",
      "POST",
      { name: "Test_Source_Parent", mimeType: MimeType.FOLDER },
    ).id;
    dstParentId = fetchAPI(
      "https://www.googleapis.com/drive/v3/files",
      "POST",
      { name: "Test_Dest_Parent", mimeType: MimeType.FOLDER },
    ).id;

    // 2. Populate the Source folder with a subfolder and some files
    const subFolderId = fetchAPI(
      "https://www.googleapis.com/drive/v3/files",
      "POST",
      { name: "SubFolder", parents: [srcParentId], mimeType: MimeType.FOLDER },
    ).id;
    fetchAPI("https://www.googleapis.com/drive/v3/files", "POST", {
      name: "File1.txt",
      parents: [srcParentId],
      mimeType: MimeType.PLAIN_TEXT,
    });
    fetchAPI("https://www.googleapis.com/drive/v3/files", "POST", {
      name: "File2.txt",
      parents: [subFolderId],
      mimeType: MimeType.PLAIN_TEXT,
    });

    console.log("Test structure created successfully.");
    console.log(`Source Folder ID: ${srcParentId}`);
    console.log(`Destination Folder ID: ${dstParentId}`);

    // 3. Get structure BEFORE move
    console.log("Retrieving folder structure BEFORE move...");
    const structureBefore = getTree(srcParentId).sort();
    console.log("Structure Before:\n" + structureBefore.join("\n"));

    // 4. Execute the refactored MoveFolder script
    console.log("Running MoveFolder script...");
    MoveFolder.run({
      srcFolderId: srcParentId,
      dstFolderId: dstParentId,
      accessToken: token,
      forSharedDrive: true, // Forced to test the complex shared drive extraction and mapping logic
    });
    console.log("MoveFolder executed successfully.");

    // 5. Find the newly created source folder inside the destination folder
    const query = `'${dstParentId}' in parents and name = 'Test_Source_Parent' and trashed = false`;
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;
    const searchRes = fetchAPI(searchUrl, "GET");
    if (!searchRes.files || searchRes.files.length === 0) {
      throw new Error("Could not find the moved folder in the destination.");
    }
    newRootId = searchRes.files[0].id;

    // 6. Get structure AFTER move
    console.log("Retrieving folder structure AFTER move...");
    const structureAfter = getTree(newRootId).sort();
    console.log("Structure After:\n" + structureAfter.join("\n"));

    // 7. Compare the structures
    const isIdentical =
      JSON.stringify(structureBefore) === JSON.stringify(structureAfter);
    if (isIdentical) {
      console.log(
        "✅ SUCCESS: The folder structure is perfectly identical before and after the move.",
      );
    } else {
      console.error("❌ FAILED: The folder structure differs after the move!");
    }
  } catch (e) {
    console.error("Test execution failed: " + e.stack);
  } finally {
    // 8. Cleanup all generated files/folders
    console.log("Cleaning up test resources...");
    const cleanup = (id) => {
      if (!id) return;
      UrlFetchApp.fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
        method: "DELETE",
        headers: headers,
        muteHttpExceptions: true,
      });
    };
    // Clean up original source (might already be deleted by script) and destination
    cleanup(srcParentId);
    cleanup(dstParentId);
    console.log("Cleanup completed.");
    console.log("--- End MoveFolder Test ---");
  }
}
