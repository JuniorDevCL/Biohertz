(function () {
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  let configPromise = null;
  let gapiReady = null;
  let gisReady = null;
  let tokenClient = null;
  let accessToken = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.head.appendChild(script);
    });
  }

  async function getConfig() {
    if (!configPromise) {
      configPromise = fetch('/auth/config', { headers: { Accept: 'application/json' } })
        .then((res) => res.json())
        .catch(() => ({}));
    }
    return configPromise;
  }

  async function ensureLibs() {
    if (!gisReady) {
      gisReady = loadScript('https://accounts.google.com/gsi/client');
    }
    if (!gapiReady) {
      gapiReady = loadScript('https://apis.google.com/js/api.js').then(() => new Promise((resolve, reject) => {
        if (!window.gapi) return reject(new Error('Google API no disponible'));
        window.gapi.load('picker', {
          callback: resolve,
          onerror: () => reject(new Error('No se pudo iniciar Google Picker')),
        });
      }));
    }
    await Promise.all([gisReady, gapiReady]);
  }

  function requestAccessToken(clientId) {
    return new Promise((resolve, reject) => {
      if (accessToken) {
        resolve(accessToken);
        return;
      }
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        reject(new Error('Google Identity no está listo'));
        return;
      }
      let settled = false;
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (settled) return;
          if (response && response.access_token) {
            settled = true;
            accessToken = response.access_token;
            resolve(accessToken);
            return;
          }
          if (response && response.error === 'popup_closed_by_user') {
            settled = true;
            reject(new Error('Se canceló el acceso a Google Drive'));
            return;
          }
          settled = true;
          reject(new Error((response && response.error) || 'No se otorgó acceso a Drive'));
        },
        error_callback: (err) => {
          if (settled) return;
          settled = true;
          reject(new Error((err && (err.message || err.type)) || 'Error al autorizar Drive'));
        },
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  function openPicker({ clientId, apiKey, appId, maxFiles, onPicked }) {
    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS_IMAGES)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMode(google.picker.DocsViewMode.LIST);

      const builder = new google.picker.PickerBuilder()
        .addView(view)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .setCallback(async (data) => {
          if (data[google.picker.Response.ACTION] === google.picker.Action.CANCEL) {
            resolve([]);
            return;
          }
          if (data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) return;
          try {
            const docs = data[google.picker.Response.DOCUMENTS] || [];
            const picked = docs.slice(0, Math.max(0, maxFiles || 4));
            const files = [];
            for (const doc of picked) {
              const file = await downloadDriveImage(doc);
              if (file) files.push(file);
            }
            if (typeof onPicked === 'function') await onPicked(files);
            resolve(files);
          } catch (err) {
            reject(err);
          }
        });

      if (appId) builder.setAppId(String(appId));
      if (clientId) builder.setOrigin(window.location.origin);

      builder.build().setVisible(true);
    });
  }

  async function downloadDriveImage(doc) {
    const id = doc[google.picker.Document.ID];
    const name = doc[google.picker.Document.NAME] || ('drive-' + id + '.jpg');
    const mime = doc[google.picker.Document.MIME_TYPE] || 'image/jpeg';
    const res = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!res.ok) {
      throw new Error('No se pudo descargar ' + name + ' desde Drive');
    }
    const blob = await res.blob();
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : mime;
    return new File([blob], name, { type: type || 'image/jpeg' });
  }

  window.openDriveFotosPicker = async function openDriveFotosPicker(options) {
    const opts = options || {};
    const maxFiles = typeof opts.maxFiles === 'number' ? opts.maxFiles : 4;
    if (maxFiles <= 0) {
      throw new Error('Ya alcanzaste el máximo de 4 fotos');
    }

    const cfg = await getConfig();
    const clientId = cfg.googleClientId || '';
    const apiKey = cfg.googleApiKey || '';
    const appId = cfg.googleAppId || '';
    if (!clientId || !apiKey) {
      throw new Error('Falta configurar GOOGLE_CLIENT_ID y GOOGLE_API_KEY para usar Drive');
    }

    await ensureLibs();
    await requestAccessToken(clientId);
    return openPicker({
      clientId,
      apiKey,
      appId,
      maxFiles,
      onPicked: opts.onPicked,
    });
  };
})();
