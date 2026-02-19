(function () {
  var dataEl = document.getElementById('file-data');
  var fileData;
  try {
    fileData = JSON.parse(dataEl?.textContent || '{}');
  } catch {
    fileData = {};
  }

  if (fileData.needsPassword) {
    showPasswordGate();
    return;
  }

  if (fileData.error) {
    showError(fileData.error);
    return;
  }

  if (fileData.isFolder) {
    showFolder(fileData);
    return;
  }

  if (!fileData.name) {
    showError('This share link may have expired or been revoked.');
    return;
  }

  showFile(fileData);

  function showPasswordGate() {
    document.getElementById('password-gate').classList.remove('hidden');
    var form = document.getElementById('password-form');
    form.action = window.location.pathname + '/verify';
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var formData = new URLSearchParams(new FormData(form));
      try {
        var res = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formData,
          credentials: 'same-origin',
          redirect: 'follow',
        });
        if (res.redirected) {
          window.location.href = res.url;
        } else if (res.ok) {
          window.location.reload();
        } else {
          var err = document.getElementById('password-error');
          err.textContent = 'Incorrect password';
          err.classList.remove('hidden');
        }
      } catch {
        var err = document.getElementById('password-error');
        err.textContent = 'Connection error';
        err.classList.remove('hidden');
      }
    });
  }

  function showError(msg) {
    document.getElementById('error-view').classList.remove('hidden');
    document.getElementById('error-message').textContent = msg;
  }

  function showFile(file) {
    document.getElementById('file-view').classList.remove('hidden');
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatBytes(file.size);
    document.getElementById('file-date').textContent = formatDate(file.uploadedAt);
    document.getElementById('file-downloads').textContent = (file.downloads || 0) + ' downloads';
    document.getElementById('file-icon').textContent = getFileIcon(file.type, file.name);
    document.title = file.name + ' — CloudVault';

    var token = window.location.pathname.split('/').pop();
    var downloadUrl = '/s/' + token + '/download';
    var previewUrl = '/s/' + token + '/preview';
    document.getElementById('download-btn').href = downloadUrl;

    setupPreview(file, previewUrl);
    setupCopyButton(token);
  }

  function showFolder(data) {
    document.getElementById('folder-view').classList.remove('hidden');
    document.title = (data.folderName || 'Shared Folder') + ' — CloudVault';

    var token = window.location.pathname.split('/').pop();
    var titleEl = document.getElementById('folder-title');
    var breadcrumbEl = document.getElementById('folder-breadcrumb');
    var subfoldersEl = document.getElementById('folder-subfolders');
    var filesEl = document.getElementById('folder-files');
    var emptyEl = document.getElementById('folder-empty');

    var currentDisplayName = data.subpath
      ? data.subpath.split('/').pop()
      : data.folderName;
    titleEl.textContent = currentDisplayName;

    breadcrumbEl.innerHTML = '';
    if (data.subpath) {
      var rootLink = document.createElement('a');
      rootLink.href = '/s/' + token;
      rootLink.textContent = data.folderName;
      rootLink.className = 'text-accent-400 hover:underline cursor-pointer';
      breadcrumbEl.appendChild(rootLink);

      var parts = data.subpath.split('/');
      for (var i = 0; i < parts.length; i++) {
        var sep = document.createElement('span');
        sep.textContent = ' / ';
        sep.className = 'text-gray-600';
        breadcrumbEl.appendChild(sep);

        if (i < parts.length - 1) {
          var partLink = document.createElement('a');
          partLink.href = '/s/' + token + '?path=' + encodeURIComponent(parts.slice(0, i + 1).join('/'));
          partLink.textContent = parts[i];
          partLink.className = 'text-accent-400 hover:underline cursor-pointer';
          breadcrumbEl.appendChild(partLink);
        } else {
          var partSpan = document.createElement('span');
          partSpan.textContent = parts[i];
          partSpan.className = 'text-white';
          breadcrumbEl.appendChild(partSpan);
        }
      }
    }

    subfoldersEl.innerHTML = '';
    var subfolders = data.subfolders || [];
    for (var s = 0; s < subfolders.length; s++) {
      var sf = subfolders[s];
      var sfName = sf.split('/').pop();
      var relativePath = sf.slice(data.folder.length + 1);

      var sfDiv = document.createElement('a');
      sfDiv.href = '/s/' + token + '?path=' + encodeURIComponent(relativePath);
      sfDiv.className = 'flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 transition-colors cursor-pointer';
      sfDiv.innerHTML = '<span class="text-lg">\uD83D\uDCC1</span><span class="text-sm text-white truncate">' + escHtml(sfName) + '</span><svg class="w-4 h-4 ml-auto text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>';
      subfoldersEl.appendChild(sfDiv);
    }

    filesEl.innerHTML = '';
    var files = data.files || [];
    for (var f = 0; f < files.length; f++) {
      var file = files[f];
      var fileDiv = document.createElement('div');
      fileDiv.className = 'flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 transition-colors group';

      var previewUrl = '/s/' + token + '/folder-preview?fileId=' + file.id;
      var isImage = file.type && file.type.startsWith('image/');
      var iconHtml = isImage
        ? '<img src="' + previewUrl + '" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
          + '<span class="w-10 h-10 rounded-lg bg-gray-700 items-center justify-center text-lg flex-shrink-0 hidden">' + escHtml(getFileIcon(file.type, file.name)) + '</span>'
        : '<span class="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center text-lg flex-shrink-0">' + escHtml(getFileIcon(file.type, file.name)) + '</span>';

      fileDiv.innerHTML = iconHtml +
        '<div class="flex-1 min-w-0"><p class="text-sm text-white truncate">' + escHtml(file.name) + '</p><p class="text-xs text-gray-500">' + formatBytes(file.size) + '</p></div>' +
        '<a href="/s/' + token + '/folder-download?fileId=' + file.id + '" class="px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white text-xs font-medium transition-all opacity-0 group-hover:opacity-100">' +
        '<svg class="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg></a>';
      filesEl.appendChild(fileDiv);
    }

    if (subfolders.length === 0 && files.length === 0) {
      emptyEl.classList.remove('hidden');
    }

    var copyBtn = document.getElementById('folder-copy-btn');
    var toast = document.getElementById('copy-toast');
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(window.location.origin + '/s/' + token).then(function () {
        toast.classList.add('show');
        setTimeout(function () { toast.classList.remove('show'); }, 2000);
      });
    });
  }

  function setupPreview(file, previewUrl) {
    var container = document.getElementById('preview-area');
    var type = file.type || '';

    if (type.startsWith('image/')) {
      var img = document.createElement('img');
      img.src = previewUrl;
      img.alt = file.name;
      img.loading = 'lazy';
      container.appendChild(img);
    } else if (type.startsWith('video/')) {
      var video = document.createElement('video');
      video.src = previewUrl;
      video.controls = true;
      video.preload = 'metadata';
      container.appendChild(video);
    } else if (type.startsWith('audio/')) {
      container.style.padding = '40px';
      var audio = document.createElement('audio');
      audio.src = previewUrl;
      audio.controls = true;
      audio.style.width = '100%';
      container.appendChild(audio);
    } else if (type === 'application/pdf') {
      var iframe = document.createElement('iframe');
      iframe.src = previewUrl;
      container.appendChild(iframe);
    } else if (type.startsWith('text/') || isCodeFile(file.name)) {
      fetch(previewUrl)
        .then(function (r) { return r.text(); })
        .then(function (text) {
          var pre = document.createElement('pre');
          var code = document.createElement('code');
          code.textContent = text.slice(0, 100000);
          pre.appendChild(code);
          container.appendChild(pre);
        })
        .catch(function () { showNoPreview(container, file); });
    } else {
      showNoPreview(container, file);
    }
  }

  function showNoPreview(container, file) {
    container.style.padding = '60px 20px';
    container.style.flexDirection = 'column';
    container.innerHTML =
      '<div style="font-size:64px;margin-bottom:16px">' + getFileIcon(file.type, file.name) + '</div>' +
      '<p style="color:#6b7280;font-size:14px">Preview not available for this file type</p>';
  }

  function isCodeFile(name) {
    return /\.(js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sh|bash|yaml|yml|toml|json|xml|sql|graphql|md|html|css|scss|less)$/i.test(name || '');
  }

  function setupCopyButton(token) {
    var btn = document.getElementById('copy-btn');
    var toast = document.getElementById('copy-toast');
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(window.location.origin + '/s/' + token).then(function () {
        toast.classList.add('show');
        setTimeout(function () { toast.classList.remove('show'); }, 2000);
      });
    });
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getFileIcon(type, name) {
    if (!type) return '\uD83D\uDCC4';
    var n = (name || '').toLowerCase();
    if (type.startsWith('image/')) return '\uD83D\uDDBC\uFE0F';
    if (type.startsWith('video/')) return '\uD83C\uDFAC';
    if (type.startsWith('audio/')) return '\uD83C\uDFB5';
    if (type === 'application/pdf') return '\uD83D\uDCC4';
    if (type.includes('zip') || type.includes('tar') || type.includes('rar') || type.includes('gzip') || type.includes('x-7z')) return '\uD83D\uDCE6';
    if (/\.(apk|aab)$/.test(n)) return '\uD83E\uDD16';
    if (/\.(exe|msi|dmg|pkg|deb|rpm)$/.test(n)) return '\uD83D\uDCBF';
    if (type.startsWith('text/') || isCodeFile(name)) return '\uD83D\uDCDD';
    return '\uD83D\uDCC4';
  }
})();
