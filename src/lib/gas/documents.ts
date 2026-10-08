import "server-only";

type GasResponse = {
  ok?: boolean;
  error?: string;
  fileId?: string;
  name?: string;
  mimeType?: string;
  base64?: string;
};

export async function callDocumentGas(payload: Record<string, string>) {
  const endpoint = process.env.GAS_WEB_APP_URL;
  const secret = process.env.GAS_SHARED_SECRET;
  if (!endpoint || !secret) {
    throw new Error("Google Apps Script integration is not configured.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, token: secret }),
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Google Apps Script returned HTTP ${response.status}.`);
  }
  return (await response.json()) as GasResponse;
}
