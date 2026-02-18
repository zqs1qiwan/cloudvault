window.UploadManager = {
  queue: [],
  active: 0,
  maxConcurrent: 3,
  chunkSize: 5 * 1024 * 1024,

  addFiles(files, folder) {
    for (const file of files) {
      this.queue.push({ file, folder, status: 'pending', progress: 0 });
    }
    this.processQueue();
  },

  processQueue() {
    while (this.active < this.maxConcurrent) {
      const item = this.queue.find(q => q.status === 'pending');
      if (!item) break;
      item.status = 'uploading';
      this.active++;
      this.uploadFile(item).finally(() => {
        this.active--;
        this.processQueue();
      });
    }
  },

  async uploadFile(item) {
    const { file, folder } = item;
    try {
      if (file.size < 10 * 1024 * 1024) {
        await this.directUpload(item);
      } else {
        await this.multipartUpload(item);
      }
      item.status = 'done';
      item.progress = 100;
      window.dispatchEvent(new CustomEvent('upload-complete', { detail: { name: file.name } }));
    } catch (err) {
      item.status = 'error';
      window.dispatchEvent(new CustomEvent('upload-error', { detail: { name: file.name, error: err.message } }));
    }
  },

  directUpload(item) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
      xhr.setRequestHeader('X-Folder', encodeURIComponent(item.folder || 'root'));
      xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          item.progress = Math.round((e.loaded / e.total) * 100);
          window.dispatchEvent(new CustomEvent('upload-progress'));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(xhr.responseText || 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(item.file);
    });
  },

  async multipartUpload(item) {
    const { file, folder } = item;
    const totalParts = Math.ceil(file.size / this.chunkSize);

    const createRes = await fetch('/api/files/upload?action=mpu-create', {
      method: 'POST',
      headers: {
        'X-File-Name': encodeURIComponent(file.name),
        'X-Folder': encodeURIComponent(folder || 'root'),
        'Content-Type': file.type || 'application/octet-stream',
      },
      credentials: 'same-origin',
    });
    if (!createRes.ok) throw new Error('Failed to create multipart upload');
    const { uploadId, key } = await createRes.json();

    const parts = [];
    for (let i = 0; i < totalParts; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      const chunk = file.slice(start, end);

      const partRes = await fetch(
        `/api/files/upload?action=mpu-upload&uploadId=${encodeURIComponent(uploadId)}&partNumber=${i + 1}&key=${encodeURIComponent(key)}`,
        { method: 'PUT', body: chunk, credentials: 'same-origin' }
      );
      if (!partRes.ok) throw new Error(`Failed to upload part ${i + 1}`);
      const partData = await partRes.json();
      parts.push({ partNumber: i + 1, etag: partData.etag });

      item.progress = Math.round(((i + 1) / totalParts) * 100);
      window.dispatchEvent(new CustomEvent('upload-progress'));
    }

    const completeRes = await fetch('/api/files/upload?action=mpu-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, key, parts }),
      credentials: 'same-origin',
    });
    if (!completeRes.ok) throw new Error('Failed to complete multipart upload');
  },
};

async function readDroppedEntries(dataTransfer) {
  const files = [];
  const items = dataTransfer.items;

  if (items && items[0] && items[0].webkitGetAsEntry) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    for (const entry of entries) {
      await readEntry(entry, '', files);
    }
  } else {
    for (const file of dataTransfer.files) {
      files.push({ file, relativePath: '' });
    }
  }
  return files;
}

function readEntry(entry, path, files) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        files.push({ file, relativePath: path });
        resolve();
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      reader.readEntries(async (entries) => {
        for (const e of entries) {
          await readEntry(e, path ? path + '/' + entry.name : entry.name, files);
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

window.readDroppedEntries = readDroppedEntries;
