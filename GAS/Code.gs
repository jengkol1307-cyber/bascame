/**
 * Google Apps Script endpoint for storing private user documents in Drive.
 *
 * Before deploying, set these Script Properties:
 * - SHARED_SECRET: a long random secret shared with the server-side app only
 * - DRIVE_FOLDER_ID: ID of the private Drive folder for uploaded documents
 *
 * Deploy as a Web app, execute as the deploying account, and restrict access
 * as appropriate for your deployment. Never put SHARED_SECRET in browser code.
 */
function doPost(e) {
  var properties = PropertiesService.getScriptProperties();
  var sharedSecret = properties.getProperty('SHARED_SECRET');
  var folderId = properties.getProperty('DRIVE_FOLDER_ID');

  if (!sharedSecret || !folderId) {
    return jsonResponse({ ok: false, error: 'Server is not configured.' });
  }

  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid JSON request.' });
  }

  if (!payload || payload.token !== sharedSecret) {
    return jsonResponse({ ok: false, error: 'Unauthorized.' });
  }

  if (payload.action === 'delete') {
    if (typeof payload.fileId !== 'string' || !payload.fileId) {
      return jsonResponse({ ok: false, error: 'Invalid document ID.' });
    }

    try {
      var file = DriveApp.getFileById(payload.fileId);
      var parents = file.getParents();
      var belongsToUploadFolder = false;
      while (parents.hasNext()) {
        if (parents.next().getId() === folderId) {
          belongsToUploadFolder = true;
        }
      }
      if (!belongsToUploadFolder) {
        return jsonResponse({ ok: false, error: 'Document not found in upload folder.' });
      }
      file.setTrashed(true);
      return jsonResponse({ ok: true });
    } catch (error) {
      console.error('Drive cleanup failed: ' + error.message);
      return jsonResponse({ ok: false, error: 'Could not remove document.' });
    }
  }

  if (payload.action === 'download') {
    if (typeof payload.fileId !== 'string' || !payload.fileId) {
      return jsonResponse({ ok: false, error: 'Invalid document ID.' });
    }

    try {
      var downloadFile = DriveApp.getFileById(payload.fileId);
      var downloadParents = downloadFile.getParents();
      var downloadBelongsToFolder = false;
      while (downloadParents.hasNext()) {
        if (downloadParents.next().getId() === folderId) {
          downloadBelongsToFolder = true;
        }
      }
      if (!downloadBelongsToFolder) {
        return jsonResponse({ ok: false, error: 'Document not found in upload folder.' });
      }
      var downloadBlob = downloadFile.getBlob();
      var downloadBytes = downloadBlob.getBytes();
      if (downloadBytes.length > 3 * 1024 * 1024) {
        return jsonResponse({ ok: false, error: 'Document exceeds the 3 MB limit.' });
      }
      return jsonResponse({
        ok: true,
        base64: Utilities.base64Encode(downloadBytes),
        mimeType: downloadBlob.getContentType()
      });
    } catch (error) {
      console.error('Drive download failed: ' + error.message);
      return jsonResponse({ ok: false, error: 'Could not retrieve document.' });
    }
  }

  if (payload.action !== 'upload') {
    return jsonResponse({ ok: false, error: 'Unsupported action.' });
  }

  if (
    typeof payload.name !== 'string' ||
    !payload.name.trim() ||
    payload.name.length > 180 ||
    typeof payload.mimeType !== 'string' ||
    typeof payload.base64 !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.base64) ||
    payload.base64.length % 4 !== 0
  ) {
    return jsonResponse({ ok: false, error: 'Invalid document details.' });
  }

  var allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png'
  ];
  if (allowedMimeTypes.indexOf(payload.mimeType) === -1) {
    return jsonResponse({ ok: false, error: 'Unsupported document type.' });
  }

  if (payload.base64.length > 4200000) {
    return jsonResponse({ ok: false, error: 'Document exceeds the 3 MB limit.' });
  }

  var bytes;
  try {
    bytes = Utilities.base64Decode(payload.base64);
  } catch (error) {
    return jsonResponse({ ok: false, error: 'Invalid document content.' });
  }

  if (!bytes.length || bytes.length > 3 * 1024 * 1024) {
    return jsonResponse({ ok: false, error: 'Document exceeds the 3 MB limit.' });
  }

  try {
    var safeName = payload.name
      .replace(/[\u0000-\u001F\u007F\\/:*?"<>|]/g, '_')
      .trim();
    var blob = Utilities.newBlob(bytes, payload.mimeType, safeName);
    var file = DriveApp.getFolderById(folderId).createFile(blob);

    return jsonResponse({
      ok: true,
      fileId: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType()
    });
  } catch (error) {
    console.error('Drive upload failed: ' + error.message);
    return jsonResponse({ ok: false, error: 'Could not store document.' });
  }
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
