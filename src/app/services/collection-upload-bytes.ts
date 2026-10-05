/** Upload a scoped capability without adding administrator authorization. */
export function uploadCollectionBytes(
  file: File,
  upload: { uploadUrl: string; method: 'PUT'; headers: Record<string, string> },
  progress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.uploadUrl);
    request.timeout = 120_000;
    for (const [name, value] of Object.entries(upload.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = event => {
      if (event.lengthComputable) progress(Math.min(100, Math.round(100 * event.loaded / event.total)));
    };
    request.onload = () => {
      // A retry may find the exact create-only object already stored. The API
      // still checks its committed bytes and malware status before accepting it.
      if ((request.status >= 200 && request.status < 300) || request.status === 412) resolve();
      else reject(new Error(`File upload returned HTTP ${request.status}. Your draft is retained.`));
    };
    request.onerror = () => reject(new Error('The file connection was interrupted. Select the same file to resume; your draft is retained.'));
    request.ontimeout = () => reject(new Error('The file upload timed out. Select the same file to resume; your draft is retained.'));
    request.onabort = () => reject(new Error('File upload stopped. Your draft is retained.'));
    request.send(file);
  });
}
